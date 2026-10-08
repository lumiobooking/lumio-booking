/**
 * SOCIAL POSTS AS ROWS — the database half. See social-posts.ts for the rules.
 *
 * Everything here is scoped by tenantId: a post is looked up by
 * (tenantId, platform, externalId), never by externalId alone, so two salons
 * that somehow share a network id can never read each other's numbers.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasMetrics, lumioPostRow, mergeReading, postRowsFrom, type MetricSet, type PostReading, type PostRow, type SocialPlatformKey } from './social-posts';

/** What the report needs of a stored post. */
export interface StoredPost extends MetricSet {
  id: string;
  platform: string;
  externalId: string;
  publishedAt: Date;
  publishedDay: string;
  periodMonth: string;
  type: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  publishedVia: string;
  metricsAt: Date | null;
}

// The generated client in some build mirrors predates these models; the
// delegates are typed loosely here so the service compiles everywhere and the
// real client (regenerated on deploy) is what runs.
interface Delegate {
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
}
interface Db { socialPost: Delegate; socialPostMetric: Delegate; tenant: { findUnique(args: unknown): Promise<{ timezone?: string | null } | null> } }

export interface RecordSummary { platform: string; seen: number; created: number; updated: number; measured: number }

@Injectable()
export class SocialPostsService {
  private readonly logger = new Logger('SocialPosts');
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db { return this.prisma as unknown as Db; }

  private async tzOf(tenantId: string): Promise<string | null> {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone ?? null;
  }

  /**
   * Write what a channel sync read. Creates posts we have not seen, updates
   * the ones we have (known metrics win, see mergeReading), and appends one
   * measurement per post that carried numbers. Never deletes.
   */
  async record(tenantId: string, platform: SocialPlatformKey, posts: PostReading[] | null | undefined, tz?: string | null, source: 'api' | 'lumio' = 'api'): Promise<RecordSummary> {
    const zone = tz === undefined ? await this.tzOf(tenantId) : tz;
    const rows = postRowsFrom(platform, posts, zone);
    const out: RecordSummary = { platform, seen: rows.length, created: 0, updated: 0, measured: 0 };
    if (!rows.length) return out;
    const existing = (await this.db.socialPost.findMany({
      where: { tenantId, platform, externalId: { in: rows.map((r) => r.externalId) } },
    })) as (StoredPost & { tenantId: string })[];
    const byId = new Map(existing.map((e) => [e.externalId, e]));
    const now = new Date();
    for (const r of rows) {
      const cur = byId.get(r.externalId);
      const measured = hasMetrics(r);
      let postId: string;
      if (!cur) {
        const created = (await this.db.socialPost.create({
          data: { tenantId, ...r, publishedVia: source === 'lumio' ? 'lumio' : 'platform', metricsAt: measured ? now : null },
          select: { id: true },
        })) as { id: string };
        postId = created.id;
        out.created++;
      } else {
        postId = cur.id;
        const patch = mergeReading(cur, r);
        if (patch || measured) {
          await this.db.socialPost.update({
            where: { id: cur.id },
            data: { ...(patch ?? {}), ...(measured ? { metricsAt: now } : {}), ...(cur.publishedVia !== 'lumio' && source === 'lumio' ? { publishedVia: 'lumio' } : {}) },
          });
          if (patch) out.updated++;
        }
      }
      if (measured) {
        await this.db.socialPostMetric.create({
          data: { tenantId, postId, capturedAt: now, views: r.views, reach: r.reach, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, interactions: r.interactions, source },
        });
        out.measured++;
      }
    }
    return out;
  }

  /**
   * A post Lumio just published: one row per channel that answered with an
   * id, so the month's count includes it before any sync runs. Best-effort —
   * publishing never fails over bookkeeping.
   */
  async recordLumio(tenantId: string, results: Array<{ channel: string; id: string | null; url?: string | null; error?: string | null; unsure?: boolean }>, postedAt: Date, caption?: string | null, thumbnail?: string | null, scheduledPostId?: string | null): Promise<void> {
    try {
      const tz = await this.tzOf(tenantId);
      for (const res of results) {
        if (!res || res.error || res.unsure || !res.id) continue;
        const row: PostRow | null = lumioPostRow({ channel: res.channel, id: res.id, url: res.url, postedAt, caption, thumbnail, tz, type: res.channel === 'tiktok' ? 'video' : null });
        if (!row) continue;
        const dup = await this.db.socialPost.count({ where: { tenantId, platform: row.platform, externalId: row.externalId } });
        if (dup) {
          if (scheduledPostId) await this.db.socialPost.updateMany({ where: { tenantId, platform: row.platform, externalId: row.externalId }, data: { publishedVia: 'lumio', scheduledPostId } });
          continue;
        }
        await this.db.socialPost.create({ data: { tenantId, ...row, publishedVia: 'lumio', scheduledPostId: scheduledPostId ?? null } });
      }
    } catch (e) {
      this.logger.warn(`recordLumio (${tenantId}) failed: ${(e as Error).message}`);
    }
  }

  /** Every live post of the salon in a report month (salon calendar). */
  async postsForMonth(tenantId: string, month: string): Promise<StoredPost[]> {
    return (await this.db.socialPost.findMany({
      where: { tenantId, periodMonth: month, deletedAt: null },
      orderBy: { publishedAt: 'desc' },
    })) as StoredPost[];
  }

  /**
   * Months synced before this table existed still hold their post lists in
   * social_insights.raw. The first time a report asks for such a month and
   * finds no rows, the stored list is written out once — the numbers the
   * report showed before are the numbers it keeps.
   */
  async backfillFromInsights(tenantId: string, month: string, insights: Array<{ platform: string; raw: unknown }>, tz?: string | null): Promise<number> {
    let total = 0;
    for (const ins of insights) {
      const platform = ins.platform as SocialPlatformKey;
      if (platform !== 'facebook' && platform !== 'instagram' && platform !== 'tiktok') continue;
      const posts = (ins.raw as { posts?: PostReading[] } | null)?.posts;
      if (!Array.isArray(posts) || !posts.length) continue;
      const r = await this.record(tenantId, platform, posts, tz);
      total += r.created;
    }
    if (total) this.logger.log(`backfilled ${total} post(s) for ${tenantId} ${month} from stored insights`);
    return total;
  }
}
