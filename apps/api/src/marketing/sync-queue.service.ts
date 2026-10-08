/**
 * THE MARKETING SYNC QUEUE. Rules in sync-plan.ts; rows in social_sync_jobs.
 *
 * Who enqueues: the daily planner (every active salon, the months that are
 * still moving), a Page webhook ("the salon just posted" — sync-signals.ts),
 * and a person pressing Sync. Who runs: the scheduler's worker tick, a few
 * jobs at a time, each claimed with a conditional update so two workers
 * never run the same row. A job that fails is retried with backoff, three
 * times, then stays 'failed' — visible on the salon's data-health strip.
 *
 * Every row carries tenantId; a job only ever syncs its own tenant.
 */
import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { MarketingService } from './marketing.service';
import { afterFailure, channelHealth, isStaleRunning, monthsToSync, type ChannelHealth } from './sync-plan';
import { dayKeyTz } from '../common/salon-time';

export interface SyncJobRow {
  id: string; tenantId: string; platform: string | null; periodMonth: string; reason: string; status: string;
  attempts: number; runAt: Date; startedAt: Date | null; finishedAt: Date | null; error: string | null; result: unknown; createdAt: Date;
}

interface Delegate {
  findMany(args: unknown): Promise<unknown[]>;
  findFirst(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  count(args: unknown): Promise<number>;
}
interface Db {
  socialSyncJob: Delegate;
  socialPost: Delegate;
  tenant: { findMany(args: unknown): Promise<Array<{ id: string; timezone?: string | null }>>; findUnique(args: unknown): Promise<{ timezone?: string | null } | null> };
  messengerConnection: { findFirst(args: unknown): Promise<{ tenantId: string } | null> };
}

const SYSTEM: AuthenticatedUser = { userId: 'system', email: 'system@lumio.local', role: UserRole.SUPER_ADMIN, tenantId: null };

export interface HealthReport {
  month: string;
  channels: ChannelHealth[];
  posts: { total: number; measuredAt: string | null };
  jobs: Array<{ id: string; platform: string | null; periodMonth: string; reason: string; status: string; attempts: number; runAt: string; finishedAt: string | null; error: string | null }>;
  queued: number;
}

@Injectable()
export class SyncQueueService {
  private readonly logger = new Logger('SyncQueue');
  constructor(private readonly prisma: PrismaService, private readonly marketing: MarketingService) {}

  private get db(): Db { return this.prisma as unknown as Db; }

  /** One queued job per (tenant, platform, month); a second request joins it. */
  async enqueue(tenantId: string, month: string, reason: string, platform: string | null = null, runAt: Date = new Date()): Promise<{ id: string; created: boolean }> {
    const open = (await this.db.socialSyncJob.findFirst({
      where: { tenantId, platform, periodMonth: month, status: 'queued' }, select: { id: true },
    })) as { id: string } | null;
    if (open) return { id: open.id, created: false };
    const row = (await this.db.socialSyncJob.create({ data: { tenantId, platform, periodMonth: month, reason, status: 'queued', runAt }, select: { id: true } })) as { id: string };
    return { id: row.id, created: true };
  }

  /** The daily plan: every active salon, the months still moving (sync-plan.ts). */
  async enqueueDaily(now = new Date()): Promise<{ tenants: number; jobs: number; months: string[] }> {
    const tenants = await this.db.tenant.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { id: true, timezone: true } });
    let jobs = 0;
    const months = new Set<string>();
    for (const t of tenants) {
      // The salon's own calendar decides whether "last month" is still settling.
      for (const m of monthsToSync(dayKeyTz(now, t.timezone || 'UTC'))) {
        months.add(m);
        const r = await this.enqueue(t.id, m, 'daily');
        if (r.created) jobs++;
      }
    }
    return { tenants: tenants.length, jobs, months: [...months].sort() };
  }

  /** A Page webhook said the Page posted: read that salon's current month soon. */
  async enqueueForPage(pageId: string, now = new Date()): Promise<boolean> {
    const conn = await this.db.messengerConnection.findFirst({ where: { pageId }, select: { tenantId: true } }).catch(() => null);
    if (!conn?.tenantId) return false;
    const t = await this.db.tenant.findUnique({ where: { id: conn.tenantId }, select: { timezone: true } }).catch(() => null);
    const month = dayKeyTz(now, t?.timezone || 'UTC').slice(0, 7);
    // A few minutes' grace: Meta's post insights are empty in the first moments.
    const r = await this.enqueue(conn.tenantId, month, 'webhook', 'meta_social', new Date(now.getTime() + 5 * 60_000));
    return r.created;
  }

  /** Jobs whose process died mid-run go back in the queue. */
  async requeueStale(now = new Date()): Promise<number> {
    const running = (await this.db.socialSyncJob.findMany({ where: { status: 'running' } })) as SyncJobRow[];
    let n = 0;
    for (const j of running) {
      if (!isStaleRunning(j, now)) continue;
      const next = afterFailure(j.attempts, now);
      await this.db.socialSyncJob.update({ where: { id: j.id }, data: { status: next.status, runAt: next.runAt, error: 'worker lost (process restarted)' } });
      n++;
    }
    return n;
  }

  /** Run up to `limit` due jobs. Returns what happened, for the log. */
  async runDue(limit = 3, now = new Date()): Promise<{ ran: number; ok: number; failed: number }> {
    await this.requeueStale(now);
    const due = (await this.db.socialSyncJob.findMany({
      where: { status: 'queued', runAt: { lte: now } }, orderBy: { runAt: 'asc' }, take: limit,
    })) as SyncJobRow[];
    let ran = 0, ok = 0, failed = 0;
    for (const j of due) {
      // Conditional claim: only the worker that flips queued → running runs it.
      const attempts = j.attempts + 1; // this try's number, from the row as read
      const claimed = await this.db.socialSyncJob.updateMany({ where: { id: j.id, status: 'queued' }, data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      ran++;
      try {
        const r = await this.runJob(j);
        if (r.failed) {
          const next = afterFailure(attempts, now);
          await this.db.socialSyncJob.update({ where: { id: j.id }, data: { status: next.status, runAt: next.runAt, finishedAt: new Date(), error: r.error, result: r.lines as never } });
          failed++;
        } else {
          await this.db.socialSyncJob.update({ where: { id: j.id }, data: { status: 'ok', finishedAt: new Date(), error: null, result: r.lines as never } });
          ok++;
        }
      } catch (e) {
        const next = afterFailure(attempts, now);
        await this.db.socialSyncJob.update({ where: { id: j.id }, data: { status: next.status, runAt: next.runAt, finishedAt: new Date(), error: String((e as Error)?.message ?? e).slice(0, 300) } }).catch(() => undefined);
        failed++;
      }
    }
    return { ran, ok, failed };
  }

  /**
   * One job = one salon, one month, every connected channel (or one). A
   * channel that is not connected is skipped, not a failure. The job fails
   * only when a connected channel answered with an error and nothing synced —
   * a partial month is kept, and the failing channel shows on its own row.
   */
  private async runJob(j: SyncJobRow): Promise<{ failed: boolean; error: string | null; lines: unknown }> {
    if (j.platform) {
      try {
        await this.marketing.syncChannel(SYSTEM, j.platform, j.periodMonth, j.tenantId);
        return { failed: false, error: null, lines: [{ platform: j.platform, state: 'synced' }] };
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        return { failed: true, error: msg, lines: [{ platform: j.platform, state: 'error', message: msg }] };
      }
    }
    const r = await this.marketing.syncAllChannels(SYSTEM, j.tenantId, j.periodMonth);
    const errors = r.lines.filter((l) => l.state === 'error');
    const failed = errors.length > 0 && r.synced === 0;
    return { failed, error: failed ? errors.map((l) => `${l.platform}: ${l.message}`).join(' · ').slice(0, 300) : null, lines: r.lines };
  }

  /** Rows older than 60 days are history nobody reads. */
  async cleanup(now = new Date()): Promise<number> {
    const r = await this.db.socialSyncJob.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 60 * 86_400_000) }, status: { in: ['ok', 'failed'] } } });
    return r.count;
  }

  /** The salon's data health, for the report screen's strip. Tenant-scoped by the caller. */
  async health(user: AuthenticatedUser, month: string, tenantParam?: string, now = new Date()): Promise<HealthReport> {
    const channels = (await this.marketing.listChannels(user, tenantParam)) as Array<{ platform: string; label: string; connected: boolean; lastSyncedAt: Date | null; lastError: string | null; enabled?: boolean }>;
    const tenantId = (await this.marketing.resolveTenant(user, tenantParam));
    const jobs = (await this.db.socialSyncJob.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 20 })) as SyncJobRow[];
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const lastFor = (platform: string) => jobs.find((j) => (j.platform === null || j.platform === platform) && (j.status === 'ok' || j.status === 'failed')) ?? null;
    const lastOkAt = (platform: string) => jobs.find((j) => (j.platform === null || j.platform === platform) && j.status === 'ok')?.finishedAt ?? null;
    const out = channels.filter((c) => c.enabled !== false).map((c) => {
      const lj = lastFor(c.platform);
      // What the job's lines say about THIS channel, when the job covered several.
      const line = Array.isArray(lj?.result) ? (lj!.result as Array<{ platform: string; state: string; message?: string | null }>).find((l) => l.platform === c.platform) : null;
      return channelHealth({
        platform: c.platform,
        connected: c.connected,
        lastSyncedAt: c.lastSyncedAt ?? lastOkAt(c.platform),
        lastError: c.lastError ?? (line?.state === 'error' ? line.message ?? null : null),
        lastJob: lj ? { status: line ? (line.state === 'error' ? 'failed' : 'ok') : lj.status, finishedAt: lj.finishedAt, error: line?.state === 'error' ? line.message ?? lj.error : null, reason: lj.reason } : null,
        queued: jobs.some((j) => j.status === 'queued' && (j.platform === null || j.platform === c.platform)),
      }, now);
    });
    const posts = (await this.db.socialPost.findMany({ where: { tenantId, periodMonth: month, deletedAt: null }, select: { metricsAt: true } })) as Array<{ metricsAt: Date | null }>;
    const measuredAt = posts.reduce<Date | null>((a, p) => (p.metricsAt && (!a || p.metricsAt > a) ? p.metricsAt : a), null);
    return {
      month,
      channels: out,
      posts: { total: posts.length, measuredAt: measuredAt ? measuredAt.toISOString() : null },
      jobs: jobs.slice(0, 8).map((j) => ({ id: j.id, platform: j.platform, periodMonth: j.periodMonth, reason: j.reason, status: j.status, attempts: j.attempts, runAt: j.runAt.toISOString(), finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null, error: j.error })),
      queued,
    };
  }

  /** A person pressed Sync: run it now, in the queue's bookkeeping. */
  async syncNow(user: AuthenticatedUser, month: string, tenantParam?: string): Promise<{ id: string; created: boolean }> {
    const tenantId = await this.marketing.resolveTenant(user, tenantParam);
    return this.enqueue(tenantId, month, 'manual', null, new Date());
  }
}
