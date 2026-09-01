/**
 * Which week a salon is in — in the salon's own clock.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * Week arithmetic is the kind of thing that looks obvious and is not. The three
 * traps, all of which this has to survive:
 *
 *   1. The salon's timezone, not the server's. A salon in Austin and one in
 *      Hanoi roll into a new week fourteen hours apart. Keying the archive off
 *      UTC would file a Sunday-evening plan in Texas under next week.
 *   2. The turn of the year. ISO weeks belong to the year of their THURSDAY, so
 *      1 January 2027 is in week 53 of 2026, and a naive `getFullYear()` files
 *      it under 2027-W53 — a week that does not exist, next to the real one.
 *   3. Sunday. JavaScript numbers Sunday 0 and ISO numbers it 7; getting that
 *      wrong moves every Sunday into the following week, which is exactly the
 *      day a salon owner sits down to read next week's plan.
 *
 * The key is a sortable string: "2026-W36". One row per salon per week.
 */

/** The salon's local calendar date, as {y, m, d}. */
import { bi, type Txt } from './i18n';

export function localParts(at: Date, tz: string): { y: number; m: number; d: number } {
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const [y, m, d] = f.format(at).split('-').map(Number);
    return { y, m, d };
  } catch {
    return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
  }
}

/** ISO week number and the year that week belongs to. */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  // Work in UTC on a date that only carries the salon's calendar day, so no
  // timezone maths can shift it again.
  const t = new Date(Date.UTC(y, m - 1, d));
  // ISO: Monday = 1 … Sunday = 7. JS gives Sunday = 0.
  const day = t.getUTCDay() || 7;
  // Step to the Thursday of this week; the year of THAT day is the week's year.
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
  return { year, week };
}

/** "2026-W36" — sortable, and one per salon per week. */
export function weekKey(at: Date, tz: string): string {
  const { y, m, d } = localParts(at, tz);
  const { year, week } = isoWeek(y, m, d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday of that salon-local week, "YYYY-MM-DD". */
export function weekStart(at: Date, tz: string): string {
  const { y, m, d } = localParts(at, tz);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  return t.toISOString().slice(0, 10);
}

/**
 * A week is PAST once the salon has moved on from it.
 *
 * A past week is frozen: the plan it holds is the plan that was agreed, and
 * refreshing it later with today's numbers would rewrite history into something
 * nobody worked from.
 */
export function isPastWeek(key: string, now: Date, tz: string): boolean {
  return key < weekKey(now, tz);
}

/**
 * "Tuần 36, 2026" / "Week 36, 2026" — for a human, not for sorting.
 *
 * Bilingual because the week archive strip is one of the few places a salon
 * looks at a LIST of weeks, and a Vietnamese word repeated down an otherwise
 * English column is the kind of thing that makes the switch look broken.
 * An unparseable key falls through as itself, the same in either language.
 */
export function weekLabel(key: string): Txt {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  return m ? bi(`Tuần ${Number(m[2])}, ${m[1]}`, `Week ${Number(m[2])}, ${m[1]}`) : key;
}
