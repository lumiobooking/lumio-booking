/**
 * CHẤM CÔNG — a shift's minutes, on the salon's calendar.
 *
 * An entry counts on the salon day it STARTED (a late shift that runs past
 * midnight stays on its day). An open entry counts up to "now" only while it
 * is still that day; an entry left open from an earlier day counts nothing and
 * is flagged ("quên chấm ra") for the owner to close. A single entry never
 * counts more than 16 hours. Pure.
 */
import { dayKeyTz } from '../common/salon-time';

export const MAX_SHIFT_MIN = 16 * 60;
export interface EntryLike { id: string; staffId?: string; clockIn: Date; clockOut: Date | null }

export function entryMinutes(e: EntryLike, tz: string, now: Date): number | null {
  const day = dayKeyTz(e.clockIn, tz);
  const end = e.clockOut ?? (day === dayKeyTz(now, tz) ? now : null);
  if (!end) return null; // left open on an earlier day
  return Math.max(0, Math.min(MAX_SHIFT_MIN, Math.round((end.getTime() - e.clockIn.getTime()) / 60_000)));
}

/** Minutes per salon day, and the entries left open on an earlier day. */
export function minutesByDay(entries: EntryLike[], tz: string, now: Date): { minutes: Record<string, number>; stale: string[] } {
  const minutes: Record<string, number> = {};
  const stale: string[] = [];
  for (const e of entries) {
    const m = entryMinutes(e, tz, now);
    if (m === null) { stale.push(e.id); continue; }
    const day = dayKeyTz(e.clockIn, tz);
    minutes[day] = (minutes[day] ?? 0) + m;
  }
  return { minutes, stale };
}

/** Group by technician. */
export function minutesByStaff(entries: EntryLike[], tz: string, now: Date): Map<string, { minutes: Record<string, number>; stale: string[] }> {
  const by = new Map<string, EntryLike[]>();
  for (const e of entries) { const k = String(e.staffId ?? ''); by.set(k, [...(by.get(k) ?? []), e]); }
  return new Map([...by].map(([k, list]) => [k, minutesByDay(list, tz, now)]));
}

/** The time a clock action may carry: never in the future, never before the day before. */
export function sanePunch(at: Date, now: Date): boolean {
  const t = at.getTime();
  return Number.isFinite(t) && t <= now.getTime() + 60_000 && t >= now.getTime() - 36 * 3600_000;
}
