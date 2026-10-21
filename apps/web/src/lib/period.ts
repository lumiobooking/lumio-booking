/**
 * Periods for measuring a salon — one vocabulary for every money screen
 * (Sales, Reports, By technician, Payments).
 *
 * The screens used three different date controls ("30D", "This month",
 * native dd/mm/yyyy inputs) and none of them could step back one period or
 * say what a number was being compared with. Big tills (Square, Shopify,
 * Toast) all work the same way, and this follows them:
 *
 *   ‹  This month · Oct 1 – 21, 2026  ›     compare: previous period
 *
 *  - a named period (today, this week, this month…) or a custom range;
 *  - ‹ › step to the previous / next period of the same kind (a month steps
 *    by whole months, a week by whole weeks), never past today;
 *  - the comparison is like-for-like: "this month so far" (Oct 1–21) is set
 *    against Sep 1–21, not against the 21 days before it.
 *
 * Days are day keys (YYYY-MM-DD) in the SALON's timezone; the caller passes
 * today's key. Weeks start on Monday, like the payroll periods. Pure — tested.
 */

export type PeriodKind = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last30' | 'last90' | 'thisYear' | 'lastYear' | 'custom';
export type PeriodUnit = 'day' | 'week' | 'month' | 'year' | 'span';
export type CompareKind = 'previous' | 'lastYear' | 'none';
export interface Period { kind: PeriodKind; unit: PeriodUnit; from: string; to: string }

export const PRESETS: PeriodKind[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last30', 'last90', 'thisYear', 'lastYear'];

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (k: string) => new Date(`${k}T00:00:00Z`);
const toKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function addDays(key: string, n: number): string {
  const d = toDate(key); d.setUTCDate(d.getUTCDate() + n); return toKey(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}
/** Monday of the week holding `key`. */
export function weekStart(key: string): string {
  const dow = (toDate(key).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(key, -dow);
}
export function monthStart(key: string): string { return `${key.slice(0, 7)}-01`; }
export function monthEnd(key: string): string {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
/** Same calendar day `n` months away, clamped to that month's last day (Mar 31 − 1 month = Feb 28). */
export function addMonths(key: string, n: number): string {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + n, d = Number(key.slice(8, 10));
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, last))}`;
}
const min = (a: string, b: string) => (a < b ? a : b);

export function periodFor(kind: PeriodKind, today: string): Period {
  switch (kind) {
    case 'today': return { kind, unit: 'day', from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { kind, unit: 'day', from: y, to: y }; }
    case 'thisWeek': return { kind, unit: 'week', from: weekStart(today), to: today };
    case 'lastWeek': { const s = addDays(weekStart(today), -7); return { kind, unit: 'week', from: s, to: addDays(s, 6) }; }
    case 'thisMonth': return { kind, unit: 'month', from: monthStart(today), to: today };
    case 'lastMonth': { const s = monthStart(addMonths(monthStart(today), -1)); return { kind, unit: 'month', from: s, to: monthEnd(s) }; }
    case 'last30': return { kind, unit: 'span', from: addDays(today, -29), to: today };
    case 'last90': return { kind, unit: 'span', from: addDays(today, -89), to: today };
    case 'thisYear': return { kind, unit: 'year', from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'lastYear': { const y = Number(today.slice(0, 4)) - 1; return { kind, unit: 'year', from: `${y}-01-01`, to: `${y}-12-31` }; }
    default: return { kind: 'custom', unit: 'span', from: today, to: today };
  }
}

/** A hand-picked range; a whole month, week or day is recognised as one. */
export function customPeriod(from: string, to: string, today: string): Period {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const named = PRESETS.map((k) => periodFor(k, today)).find((p) => p.from === a && p.to === b);
  if (named) return named;
  if (a === b) return { kind: 'custom', unit: 'day', from: a, to: b };
  if (a === monthStart(a) && (b === monthEnd(a) || (b === today && b.slice(0, 7) === a.slice(0, 7)))) return { kind: 'custom', unit: 'month', from: a, to: b };
  if (a === weekStart(a) && (daysBetween(a, b) === 6 || (b === today && daysBetween(a, b) < 7))) return { kind: 'custom', unit: 'week', from: a, to: b };
  return { kind: 'custom', unit: 'span', from: a, to: b };
}

/** One period back (‹) or forward (›), by whole units; never past today. */
export function shiftPeriod(p: Period, dir: -1 | 1, today: string): Period {
  let from: string, to: string;
  if (p.unit === 'day') { from = addDays(p.from, dir); to = from; }
  else if (p.unit === 'week') { from = addDays(weekStart(p.from), 7 * dir); to = addDays(from, 6); }
  else if (p.unit === 'month') { from = monthStart(addMonths(p.from, dir)); to = monthEnd(from); }
  else if (p.unit === 'year') { const y = Number(p.from.slice(0, 4)) + dir; from = `${y}-01-01`; to = `${y}-12-31`; }
  else { const len = daysBetween(p.from, p.to) + 1; from = addDays(p.from, len * dir); to = addDays(p.to, len * dir); }
  if (from > today) return p;
  return customPeriod(from, min(to, today), today);
}
export const canStepForward = (p: Period, today: string) => p.to < today;

/**
 * What a period is measured against. "Previous" is like-for-like: a month so
 * far against the same days of the month before, a week so far against the
 * same weekdays of last week; a hand-picked span against the days just before.
 */
export function comparePeriod(p: Period, cmp: CompareKind): { from: string; to: string } | null {
  if (cmp === 'none') return null;
  if (cmp === 'lastYear') return { from: addMonths(p.from, -12), to: addMonths(p.to, -12) };
  const len = daysBetween(p.from, p.to);
  if (p.unit === 'day') return { from: addDays(p.from, -1), to: addDays(p.from, -1) };
  if (p.unit === 'week') { const f = addDays(p.from, -7); return { from: f, to: addDays(f, len) }; }
  if (p.unit === 'month') { const f = addMonths(p.from, -1); return { from: f, to: min(addMonths(p.to, -1), monthEnd(f)) }; }
  if (p.unit === 'year') return { from: addMonths(p.from, -12), to: addMonths(p.to, -12) };
  return { from: addDays(p.from, -(len + 1)), to: addDays(p.from, -1) };
}

export function inPeriod(dayKey: string, p: { from: string; to: string }): boolean {
  return dayKey >= p.from && dayKey <= p.to;
}

/** "Oct 1 – 21, 2026", "Sep 28 – Oct 4, 2026", "Tue, Oct 20, 2026", "October 2026", in the app's locale. */
export function rangeText(from: string, to: string, locale: string): string {
  const f = (k: string, o: Intl.DateTimeFormatOptions) => toDate(k).toLocaleDateString(locale, { timeZone: 'UTC', ...o });
  if (from === to) return f(from, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (from === monthStart(from) && to === monthEnd(from)) return f(from, { month: 'long', year: 'numeric' });
  if (from === `${from.slice(0, 4)}-01-01` && to === `${from.slice(0, 4)}-12-31`) return from.slice(0, 4);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${f(from, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} – ${f(to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function kindLabel(k: PeriodKind, vi: boolean): string {
  const L: Record<PeriodKind, [string, string]> = {
    today: ['Hôm nay', 'Today'], yesterday: ['Hôm qua', 'Yesterday'], thisWeek: ['Tuần này', 'This week'], lastWeek: ['Tuần trước', 'Last week'],
    thisMonth: ['Tháng này', 'This month'], lastMonth: ['Tháng trước', 'Last month'], last30: ['30 ngày qua', 'Last 30 days'], last90: ['90 ngày qua', 'Last 90 days'],
    thisYear: ['Năm nay', 'This year'], lastYear: ['Năm trước', 'Last year'], custom: ['Tuỳ chọn', 'Custom'],
  };
  return L[k][vi ? 0 : 1];
}

/** Percent change, or null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}
