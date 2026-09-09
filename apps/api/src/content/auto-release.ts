/**
 * When a drafted day goes live for the salon on its own.
 *
 * The planner drafts every salon's ideas hourly and, until now, every one of
 * them waited for a person to press "Phát hành" in the Super Admin queue —
 * so a salon whose morning nobody swept saw "Hôm nay chưa có gợi ý" all day,
 * and the team's promise that the plan updates itself was only true on the
 * days somebody remembered. Drafts now release themselves once the salon's
 * morning has begun; the queue is for the hours before that, and for the
 * salons a person has chosen to hold.
 *
 * Pure: the scheduler feeds it clocks, the tests feed it numbers.
 */

/** The salon's local hour from which a drafted day may go live. Early enough
 *  that the plan is there when the owner opens the app with coffee, late
 *  enough that the night's drafts sat in the queue for anyone up before it. */
export const RELEASE_HOUR = 7;

export interface ReleaseClock {
  /** The draft's day, YYYY-MM-DD. */
  forDate: string;
  /** The salon's current local day, YYYY-MM-DD. */
  localDay: string;
  /** The salon's current local hour, 0-23. */
  localHour: number;
  /** 'manual' = a person holds this salon's drafts; anything else releases. */
  mode?: string | null;
  releaseHour?: number;
}

/** Yesterday's draft that never went out is still due — a plan for a day
 *  that has passed is worth nothing, but the ideas are, and the salon's
 *  screen reads them by date. Tomorrow's is not due until tomorrow. */
export function dueForRelease(c: ReleaseClock): boolean {
  if ((c.mode ?? 'auto') === 'manual') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.forDate) || !/^\d{4}-\d{2}-\d{2}$/.test(c.localDay)) return false;
  if (c.forDate > c.localDay) return false;
  if (c.forDate < c.localDay) return true;
  return c.localHour >= (c.releaseHour ?? RELEASE_HOUR);
}

/** The hour on the wall where the salon stands. */
export function localHourIn(tz: string, d = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(d);
    const n = Number(h.replace(/\D/g, ''));
    return Number.isFinite(n) ? n % 24 : d.getUTCHours();
  } catch {
    return d.getUTCHours();
  }
}
