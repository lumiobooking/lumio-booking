/**
 * MONTH FACTS — the numbers the client asks first, computed by code from the
 * salon's stored posts (social_posts), never by the AI and never re-read from
 * the network at report time:
 *
 *   how many posts this month · total interactions · the five best posts.
 *
 * Pure. The rules a report reader would expect:
 *  - "This month" is the salon's calendar month (periodMonth, already in the
 *    salon's timezone when the row was written).
 *  - A number nobody measured is null, and null is shown as "—", never as 0.
 *    A month with posts but no readable metrics has interactions = null,
 *    not 0 — the salon did post; we just could not read the reactions.
 *  - Month-over-month movement only when BOTH months have the number and the
 *    previous one is not 0. A month still running is compared to the same
 *    number of days of the previous month ("to date"), not the whole of it.
 *  - Top posts rank by interactions, then views, then recency. A post with
 *    no numbers at all cannot be "best" and is left out of the ranking.
 */
import type { StoredPost } from './social-posts.service';

export type PlatformKey = 'facebook' | 'instagram' | 'tiktok';

export interface PlatformFacts {
  platform: PlatformKey;
  posts: number;
  byType: Record<string, number>;
  interactions: number | null;
  views: number | null;
  viaLumio: number;
}

export interface TopPost {
  id: string;
  platform: PlatformKey;
  type: string;
  publishedAt: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number | null;
  viaLumio: boolean;
}

export interface Delta { value: number | null; prev: number | null; pct: number | null }

export interface MonthFacts {
  month: string;
  /** 'closed' = the month is over; 'to-date' = still running, compared to the same days last month. */
  state: 'closed' | 'to-date';
  /** Days of the month covered (= day of month when to-date). */
  daysCovered: number;
  posts: { total: number; byPlatform: PlatformFacts[]; vsPrev: Delta };
  interactions: { total: number | null; vsPrev: Delta };
  views: { total: number | null; vsPrev: Delta };
  top: TopPost[];
  /** The newest measurement among the month's posts; null when none was ever read. */
  measuredAt: string | null;
  /** Plain-words reasons a number is null, for the screen (never for the AI to guess around). */
  notes: string[];
}

const sumOrNull = (xs: Array<number | null | undefined>): number | null => {
  const known = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

export function delta(cur: number | null, prev: number | null): Delta {
  if (cur == null && prev == null) return { value: null, prev: null, pct: null };
  const pct = cur != null && prev != null && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  return { value: cur, prev, pct };
}

/** 'YYYY-MM' of the month before. */
export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Days in a calendar month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const PLATFORMS: PlatformKey[] = ['facebook', 'instagram', 'tiktok'];
const isPlatform = (p: string): p is PlatformKey => (PLATFORMS as string[]).includes(p);

function platformFacts(platform: PlatformKey, posts: StoredPost[]): PlatformFacts {
  const byType: Record<string, number> = {};
  for (const p of posts) byType[p.type || 'post'] = (byType[p.type || 'post'] ?? 0) + 1;
  return {
    platform,
    posts: posts.length,
    byType,
    interactions: sumOrNull(posts.map((p) => p.interactions)),
    views: sumOrNull(posts.map((p) => p.views)),
    viaLumio: posts.filter((p) => p.publishedVia === 'lumio').length,
  };
}

export function rankPosts(posts: StoredPost[], limit = 5): StoredPost[] {
  return posts
    .filter((p) => p.interactions != null || p.views != null)
    .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0) || (b.views ?? 0) - (a.views ?? 0) || b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, limit);
}

/**
 * @param posts   this month's live posts (tenant-scoped by the caller)
 * @param prev    last month's live posts
 * @param todayKey 'YYYY-MM-DD' in the salon's timezone — decides closed vs to-date
 */
export function monthFacts(month: string, posts: StoredPost[], prev: StoredPost[], todayKey: string): MonthFacts {
  const running = todayKey.slice(0, 7) === month;
  const dayOfMonth = running ? Math.max(1, Number(todayKey.slice(8, 10)) || 1) : daysInMonth(month);
  // Same days of last month when the month is still running.
  const prevCut = running ? prev.filter((p) => Number(p.publishedDay.slice(8, 10)) <= dayOfMonth) : prev;

  const live = posts.filter((p) => isPlatform(p.platform));
  const byPlatform = PLATFORMS
    .map((pf) => platformFacts(pf, live.filter((p) => p.platform === pf)))
    .filter((f) => f.posts > 0);

  const interactions = sumOrNull(live.map((p) => p.interactions));
  const views = sumOrNull(live.map((p) => p.views));
  const prevInteractions = sumOrNull(prevCut.map((p) => p.interactions));
  const prevViews = sumOrNull(prevCut.map((p) => p.views));

  const top: TopPost[] = rankPosts(live).map((p) => ({
    id: p.id, platform: p.platform as PlatformKey, type: p.type, publishedAt: p.publishedAt.toISOString(),
    permalink: p.permalink, thumbnailUrl: p.thumbnailUrl, caption: p.caption,
    views: p.views, reach: p.reach, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves,
    interactions: p.interactions, viaLumio: p.publishedVia === 'lumio',
  }));

  const measuredAt = live.reduce<Date | null>((acc, p) => (p.metricsAt && (!acc || p.metricsAt > acc) ? p.metricsAt : acc), null);
  const notes: string[] = [];
  if (live.length && interactions == null) notes.push('no-metrics');          // posts known, reactions never read
  const unmeasured = live.filter((p) => p.interactions == null && p.views == null).length;
  if (unmeasured && unmeasured < live.length) notes.push(`unmeasured:${unmeasured}`); // some posts without numbers yet

  return {
    month,
    state: running ? 'to-date' : 'closed',
    daysCovered: dayOfMonth,
    posts: { total: live.length, byPlatform, vsPrev: delta(live.length, prevCut.length) },
    interactions: { total: interactions, vsPrev: delta(interactions, prevInteractions) },
    views: { total: views, vsPrev: delta(views, prevViews) },
    top,
    measuredAt: measuredAt ? measuredAt.toISOString() : null,
    notes,
  };
}
