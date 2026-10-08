/**
 * SOCIAL POSTS AS ROWS — the pure half.
 *
 * A channel sync hands back a list of posts with whatever the network said
 * about each (PostInsight). This module turns that list into rows for the
 * social_posts table and decides, for a post we already hold, what the new
 * reading changes. The service (social-posts.service.ts) only does the
 * database calls.
 *
 * Rules:
 *  - A post that cannot prove its time is not a row. The month a post belongs
 *    to is the salon's calendar month (tenant timezone), never UTC.
 *  - A metric the network did not give (null) never overwrites one it gave
 *    before. Metrics only go stale, never blank.
 *  - "interactions" is always recomputed from what is known, so a post with
 *    likes and comments but no shares still ranks.
 */
import { dayKeyTz } from '../common/salon-time';

export type SocialPlatformKey = 'facebook' | 'instagram' | 'tiktok';

/** What a connector says about one post (mirrors PostInsight, loosened). */
export interface PostReading {
  id: string;
  type?: string | null;
  timestamp?: string | null;
  permalink?: string | null;
  thumbnail?: string | null;
  caption?: string | null;
  likes?: number | null;
  comments?: number | null;
  reach?: number | null;
  views?: number | null;
  saved?: number | null;
  shares?: number | null;
  interactions?: number | null;
}

export interface MetricSet {
  views: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; interactions: number | null;
}

export interface PostRow extends MetricSet {
  platform: SocialPlatformKey;
  externalId: string;
  publishedAt: Date;
  publishedDay: string;
  periodMonth: string;
  type: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? Math.max(0, Math.round(n)) : null;
};

/** reel | video | photo | carousel | post — one vocabulary across networks. */
export function normalizeType(platform: SocialPlatformKey, type?: string | null): string {
  const t = String(type ?? '').toLowerCase();
  if (t === 'reel' || t === 'reels') return 'reel';
  if (t === 'video') return platform === 'instagram' ? 'reel' : 'video';
  if (t === 'image' || t === 'photo') return 'photo';
  if (t === 'carousel' || t === 'carousel_album') return 'carousel';
  if (platform === 'tiktok') return 'video';
  return 'post';
}

/** Sum of what is known; null only when nothing is known. */
export function interactionsOf(m: { likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }): number | null {
  const parts = [m.likes, m.comments, m.shares, m.saves].map(num);
  if (parts.every((p) => p == null)) return null;
  return parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

/** One reading → one row, or null when the post has no usable id/time. */
export function postRowFrom(platform: SocialPlatformKey, p: PostReading, tz: string | null | undefined): PostRow | null {
  const externalId = String(p?.id ?? '').trim();
  const t = Date.parse(String(p?.timestamp ?? ''));
  if (!externalId || !Number.isFinite(t)) return null;
  const publishedAt = new Date(t);
  const zone = tz || 'UTC';
  const publishedDay = dayKeyTz(publishedAt, zone);
  const likes = num(p.likes), comments = num(p.comments), shares = num(p.shares), saves = num(p.saved);
  const known = interactionsOf({ likes, comments, shares, saves });
  return {
    platform,
    externalId,
    publishedAt,
    publishedDay,
    periodMonth: publishedDay.slice(0, 7),
    type: normalizeType(platform, p.type),
    permalink: typeof p.permalink === 'string' && /^https?:\/\//.test(p.permalink) ? p.permalink.slice(0, 500) : null,
    thumbnailUrl: typeof p.thumbnail === 'string' && /^https?:\/\//.test(p.thumbnail) ? p.thumbnail.slice(0, 1000) : null,
    caption: p.caption ? String(p.caption).replace(/\s+/g, ' ').trim().slice(0, 300) || null : null,
    views: num(p.views),
    reach: num(p.reach),
    likes, comments, shares, saves,
    // The connector's own total when it has one and we could not add anything up.
    // A connector total of 0 with no known parts is "nothing read", not 0.
    interactions: known ?? (num(p.interactions) || null),
  };
}

/** Every usable row from a connector's list. Duplicated ids keep the first. */
export function postRowsFrom(platform: SocialPlatformKey, posts: PostReading[] | null | undefined, tz: string | null | undefined): PostRow[] {
  const seen = new Set<string>();
  const out: PostRow[] = [];
  for (const p of posts ?? []) {
    const row = postRowFrom(platform, p, tz);
    if (!row || seen.has(row.externalId)) continue;
    seen.add(row.externalId);
    out.push(row);
  }
  return out;
}

const METRIC_KEYS: (keyof MetricSet)[] = ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'interactions'];

/**
 * What to write over a stored post given a fresh reading: a known metric wins
 * over an unknown one; descriptive fields fill in only when they were empty
 * (a caption the salon edited on Facebook is not worth an overwrite, a
 * thumbnail we never had is). Returns null when nothing changes.
 */
export function mergeReading(stored: Partial<Omit<PostRow, 'platform'>> & MetricSet, fresh: PostRow): (Partial<PostRow> & Partial<MetricSet>) | null {
  const patch: Record<string, unknown> = {};
  for (const k of METRIC_KEYS) {
    const nv = fresh[k];
    if (nv != null && nv !== stored[k]) patch[k] = nv;
  }
  if (!stored.permalink && fresh.permalink) patch.permalink = fresh.permalink;
  if (!stored.thumbnailUrl && fresh.thumbnailUrl) patch.thumbnailUrl = fresh.thumbnailUrl;
  if (!stored.caption && fresh.caption) patch.caption = fresh.caption;
  if ((!stored.type || stored.type === 'post') && fresh.type !== 'post') patch.type = fresh.type;
  return Object.keys(patch).length ? (patch as Partial<PostRow>) : null;
}

/** True when the reading carries at least one number worth a history row. */
export function hasMetrics(m: Partial<MetricSet>): boolean {
  return METRIC_KEYS.some((k) => m[k] != null);
}

/** A post Lumio itself published → the same row shape (no metrics yet). */
export function lumioPostRow(input: {
  channel: string; id: string | null | undefined; url?: string | null; postedAt: Date | string | null | undefined;
  caption?: string | null; thumbnail?: string | null; tz?: string | null; type?: string | null;
}): PostRow | null {
  const platform = input.channel === 'facebook' || input.channel === 'instagram' || input.channel === 'tiktok' ? input.channel : null;
  if (!platform || !input.id) return null;
  const at = input.postedAt ? new Date(input.postedAt) : null;
  return postRowFrom(platform, {
    id: String(input.id), timestamp: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    permalink: input.url ?? null, thumbnail: input.thumbnail ?? null, caption: input.caption ?? null, type: input.type ?? null,
  }, input.tz);
}
