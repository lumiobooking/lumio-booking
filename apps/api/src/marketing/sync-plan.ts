/**
 * THE SYNC PLAN — pure rules behind the marketing sync queue
 * (sync-queue.service.ts). Nothing here touches the network or the database.
 *
 *  - Which months a daily run reads. The current month, always. The month
 *    that just ended keeps being re-read while its posts' numbers are still
 *    moving: Meta keeps adding views and reactions to a post for weeks after
 *    it goes up, so a month read once on the 1st is short for ever. It is read
 *    daily for the first week after it ends, then every third day until the
 *    oldest post of that month is ~35 days old.
 *  - How a failed job comes back: three tries, 15 → 60 → 240 minutes apart.
 *  - What counts as a job that died with the process (claimed, never finished).
 *  - How a channel's state reads in plain words.
 */

export const MAX_ATTEMPTS = 3;
/** A job still 'running' after this long was lost with its process; re-queue it. */
export const STALE_RUNNING_MS = 45 * 60 * 1000;
/** Keep re-reading a finished month until its posts are this old. */
export const REFRESH_DAYS_AFTER_MONTH_END = 35;

const pad = (n: number) => String(n).padStart(2, '0');

export function prevMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Days from the first of `month` to `dayKey` (both calendar, UTC arithmetic on date keys). */
function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.UTC(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, Number(fromKey.slice(8, 10)));
  const b = Date.UTC(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, Number(toKey.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Months the daily planner reads today. `todayKey` is 'YYYY-MM-DD'. The
 * previous month rides along while it is still "settling" (see above).
 */
export function monthsToSync(todayKey: string): string[] {
  const month = todayKey.slice(0, 7);
  const out = [month];
  const prev = prevMonthOf(month);
  // Days since the previous month ended = day of month (the 1st is day 1 after).
  const sinceEnd = daysBetween(`${month}-01`, todayKey) + 1;
  if (sinceEnd <= 7 || (sinceEnd <= REFRESH_DAYS_AFTER_MONTH_END && sinceEnd % 3 === 0)) out.push(prev);
  return out;
}

/** Minutes to wait before try number `attempts + 1`. */
export function backoffMinutes(attempts: number): number {
  return [15, 60, 240][Math.min(Math.max(attempts, 1), 3) - 1];
}

export interface JobLike {
  status: string;
  attempts: number;
  startedAt?: Date | null;
}

/** A claimed job whose process never came back. */
export function isStaleRunning(job: JobLike, now: Date): boolean {
  return job.status === 'running' && !!job.startedAt && now.getTime() - job.startedAt.getTime() > STALE_RUNNING_MS;
}

/** After a failure: another try (with its not-before time) or give up. */
export function afterFailure(attempts: number, now: Date): { status: 'queued' | 'failed'; runAt: Date } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed', runAt: now };
  return { status: 'queued', runAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) };
}

// ---------------------------------------------------------------------------
// Data health, in plain words.

export type HealthLevel = 'ok' | 'warn' | 'bad' | 'off';

export interface ChannelHealthInput {
  platform: string;
  connected: boolean;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
  /** The newest job that touched this channel (or the whole salon). */
  lastJob?: { status: string; finishedAt?: Date | null; error?: string | null; reason?: string } | null;
  queued?: boolean;
}

export interface ChannelHealth {
  platform: string;
  level: HealthLevel;
  /** Short status for a chip; the UI translates by key. */
  key: 'not-connected' | 'fresh' | 'stale' | 'queued' | 'failed' | 'permission' | 'never';
  lastSyncedAt: string | null;
  detail: string | null;
}

const PERMISSION_RE = /permission|\(#10\)|\(#200\)|\(#190\)|pages_read_engagement|pages_read_user_content|instagram_manage_insights|OAuthException|token/i;

/** The permission a Meta error is really asking for, when it names one. */
export function permissionIn(error: string | null | undefined): string | null {
  const m = String(error ?? '').match(/pages_read_engagement|pages_read_user_content|instagram_manage_insights|instagram_basic|ads_read|pages_show_list/);
  return m ? m[0] : null;
}

export function channelHealth(c: ChannelHealthInput, now: Date): ChannelHealth {
  const last = c.lastSyncedAt ? new Date(c.lastSyncedAt) : null;
  const iso = last ? last.toISOString() : null;
  if (!c.connected) return { platform: c.platform, level: 'off', key: 'not-connected', lastSyncedAt: null, detail: null };
  const err = c.lastError || c.lastJob?.error || null;
  if (err && PERMISSION_RE.test(err)) return { platform: c.platform, level: 'bad', key: 'permission', lastSyncedAt: iso, detail: permissionIn(err) ?? err.slice(0, 160) };
  if (c.lastJob?.status === 'failed' || (err && (!last || now.getTime() - last.getTime() > 36 * 3_600_000))) {
    return { platform: c.platform, level: 'bad', key: 'failed', lastSyncedAt: iso, detail: (err ?? '').slice(0, 160) || null };
  }
  if (c.queued && (!last || now.getTime() - last.getTime() > 36 * 3_600_000)) return { platform: c.platform, level: 'warn', key: 'queued', lastSyncedAt: iso, detail: null };
  if (!last) return { platform: c.platform, level: 'warn', key: 'never', lastSyncedAt: null, detail: null };
  if (now.getTime() - last.getTime() > 36 * 3_600_000) return { platform: c.platform, level: 'warn', key: 'stale', lastSyncedAt: iso, detail: null };
  return { platform: c.platform, level: 'ok', key: 'fresh', lastSyncedAt: iso, detail: err ? err.slice(0, 160) : null };
}
