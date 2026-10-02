/**
 * Pay periods on the SALON's calendar, as plain "YYYY-MM-DD" day keys.
 *
 * Day-key arithmetic is done on UTC noon so no timezone or daylight-saving
 * change can move a day; which day is "today" is decided by the caller, in the
 * salon's timezone.
 */

export type PayPeriodKind = 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
export const PAY_PERIODS: PayPeriodKind[] = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'];

const DAY_MS = 86400000;
const toDate = (k: string) => new Date(`${k}T12:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

export const isDayKey = (k: unknown): k is string => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(toDate(k).getTime()) && toKey(toDate(k)) === k;
export const addDays = (k: string, n: number) => toKey(new Date(toDate(k).getTime() + n * DAY_MS));
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;
export const weekdayOf = (k: string) => toDate(k).getUTCDay(); // 0 = Sunday
export const daysInMonth = (k: string) => new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).getUTCDate();

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from, g = 0; k <= to && g < 400; k = addDays(k, 1), g++) out.push(k);
  return out;
}

/** The period that contains `day`. `anchor` is any first day of a weekly / two-weekly period. */
export function periodContaining(kind: PayPeriodKind, day: string, anchor = '2026-01-05'): { from: string; to: string } {
  if (kind === 'MONTHLY') {
    const from = `${day.slice(0, 7)}-01`;
    return { from, to: `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, '0')}` };
  }
  if (kind === 'SEMIMONTHLY') {
    const d = Number(day.slice(8, 10));
    return d <= 15
      ? { from: `${day.slice(0, 7)}-01`, to: `${day.slice(0, 7)}-15` }
      : { from: `${day.slice(0, 7)}-16`, to: `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, '0')}` };
  }
  const len = kind === 'WEEKLY' ? 7 : 14;
  const a = isDayKey(anchor) ? anchor : '2026-01-05';
  const offset = Math.round((toDate(day).getTime() - toDate(a).getTime()) / DAY_MS);
  const start = addDays(a, Math.floor(offset / len) * len);
  return { from: start, to: addDays(start, len - 1) };
}

/** This period and the `count - 1` before it, newest first. */
export function recentPeriods(kind: PayPeriodKind, today: string, count: number, anchor?: string) {
  const out: { from: string; to: string }[] = [];
  let p = periodContaining(kind, today, anchor);
  for (let i = 0; i < count; i++) {
    out.push(p);
    p = periodContaining(kind, addDays(p.from, -1), anchor);
  }
  return out;
}
