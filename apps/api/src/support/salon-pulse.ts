/**
 * THE PULSE OF ONE SALON, READ FROM THE AGENCY LIST.
 *
 * The team used to open every salon to find out whether it was growing and
 * whether its ads were doing anything. Three hundred salons, one at a time.
 * This module turns two counts a tenant-grouped query can give for the whole
 * list at once — bookings this month, bookings over the same span of last
 * month — into a verdict the list can print in one word, and the month's ad
 * spend plus the bookings that came through a paid channel into a second one.
 *
 * It is pure: the service fetches, this file judges, the spec checks the
 * judgement. Nothing here touches a database.
 *
 * WHAT "SAME SPAN" MEANS. On the 16th we compare the 1st–16th of this month
 * with the 1st–16th of last month, never with last month entire — a half
 * month against a whole one reads "down 50%" on every salon every time.
 *
 * WHAT WE REFUSE TO SAY. With fewer than ten bookings in the comparison span
 * a percentage is noise (7 → 9 is "+29%"), and a salon younger than a month
 * has no last month to compare with. Both print "chưa đủ dữ liệu" instead of
 * a verdict, because a wrong arrow sends an employee to the wrong shop.
 *
 * Months are UTC, like `periodMonth` on marketing spend and the ads receipt;
 * a salon's own day boundary moves a booking at most a few hours either side
 * of the first, which the thresholds above absorb.
 */

export type GrowthKind = 'up' | 'flat' | 'down' | 'thin';
export type AdsKind = 'on' | 'warn' | 'off' | 'none';

export interface PulseBookings {
  /** Bookings so far this month (not cancelled, not no-show). */
  month: number;
  /** Bookings over the same number of days at the start of last month. */
  lastSameSpan: number;
  /** Last month entire — the "reference" figure the list prints under the arrow. */
  lastMonth: number;
  /** Five months, oldest first, the last one being this month so far. */
  series: number[];
  /** Month-to-date vs. same span last month, in whole percent; null when thin. */
  pct: number | null;
}

export interface GrowthVerdict { kind: GrowthKind; label: string; reason: string }

export interface AdsPulse {
  kind: AdsKind;
  /** Paid-channel spend recorded for this month (cents). */
  spendCents: number;
  /** Bookings this month whose channel is one an ad can buy (Google, Meta, Zalo). */
  bookings: number;
  /** spend ÷ bookings, or null when nothing came in yet. */
  perBookingCents: number | null;
  /** When kind is 'off': the last month that had paid spend ('YYYY-MM'). */
  lastMonth: string | null;
}

export interface SalonPulse { bookings: PulseBookings; growth: GrowthVerdict; ads: AdsPulse }

/** Money that bought clicks. SEO, email and SMS are billed work, not ad spend. */
export const PAID_CHANNELS = ['facebook', 'instagram', 'google_ads', 'tiktok', 'zalo'];

/** Fewer bookings than this in the comparison span and the percentage is noise. */
export const THIN_BOOKINGS = 10;
/** A salon younger than this has no comparable last month. */
export const THIN_AGE_DAYS = 30;
/** Spend from which "zero bookings from ads" is worth a flag ($50). */
export const ADS_WARN_CENTS = 5000;
/** A move smaller than this, either way, is "flat". */
export const FLAT_PCT = 10;

export interface MonthWindows {
  /** 'YYYY-MM' of the current month. */
  key: string;
  thisStart: Date;
  now: Date;
  lastStart: Date;
  /** Same day-of-month and time of day, one month earlier (clamped to that month). */
  lastSameEnd: Date;
  /** Oldest first; the last window is this month up to `now`. */
  series: { key: string; start: Date; end: Date }[];
}

function monthStart(y: number, m: number): Date { return new Date(Date.UTC(y, m, 1)); }
function keyOf(d: Date): string { return d.toISOString().slice(0, 7); }

export function monthWindows(now: Date, months = 5): MonthWindows {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisStart = monthStart(y, m);
  const lastStart = monthStart(y, m - 1);
  const daysInLast = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const sameDay = Math.min(now.getUTCDate(), daysInLast);
  const lastSameEnd = new Date(Date.UTC(y, m - 1, sameDay, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
  const series: MonthWindows['series'] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = monthStart(y, m - i);
    const end = i === 0 ? now : monthStart(y, m - i + 1);
    series.push({ key: keyOf(start), start, end });
  }
  return { key: keyOf(thisStart), thisStart, now, lastStart, lastSameEnd, series };
}

/** Whole-percent change, or null when there is nothing to compare against. */
export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export function growthVerdict(b: { month: number; lastSameSpan: number }, tenantAgeDays: number): GrowthVerdict {
  if (tenantAgeDays < THIN_AGE_DAYS) {
    return { kind: 'thin', label: 'Tiệm mới', reason: 'chưa đủ một tháng để so với tháng trước' };
  }
  if (b.month === 0 && b.lastSameSpan === 0) {
    return { kind: 'thin', label: 'Chưa có booking', reason: 'không có booking tháng này lẫn cùng kỳ tháng trước' };
  }
  if (b.lastSameSpan < THIN_BOOKINGS) {
    return { kind: 'thin', label: 'Chưa đủ dữ liệu', reason: `cùng kỳ tháng trước chỉ có ${b.lastSameSpan} booking — chưa so được` };
  }
  const pct = pctChange(b.month, b.lastSameSpan) ?? 0;
  const span = `cùng kỳ tháng trước ${b.lastSameSpan} → ${b.month}`;
  if (pct >= FLAT_PCT) return { kind: 'up', label: `▲ +${pct}%`, reason: span };
  if (pct <= -FLAT_PCT) return { kind: 'down', label: `▼ ${pct}%`, reason: span };
  return { kind: 'flat', label: `${pct >= 0 ? '+' : ''}${pct}%`, reason: span };
}

export function adsVerdict(a: { spendCents: number; bookings: number; lastSpendMonth: string | null }, thisMonthKey: string): AdsPulse {
  const spendCents = Math.max(0, Math.round(a.spendCents || 0));
  const bookings = Math.max(0, a.bookings || 0);
  if (spendCents > 0) {
    const perBookingCents = bookings > 0 ? Math.round(spendCents / bookings) : null;
    const kind: AdsKind = bookings === 0 && spendCents >= ADS_WARN_CENTS ? 'warn' : 'on';
    return { kind, spendCents, bookings, perBookingCents, lastMonth: thisMonthKey };
  }
  if (a.lastSpendMonth) return { kind: 'off', spendCents: 0, bookings, perBookingCents: null, lastMonth: a.lastSpendMonth };
  return { kind: 'none', spendCents: 0, bookings, perBookingCents: null, lastMonth: null };
}

/** How the list prints an 'off'/'on' month key: '2026-09' → 'T9/2026'. */
export function monthLabel(key: string | null): string {
  if (!key) return '';
  const [y, m] = key.split('-');
  return `T${Number(m)}/${y}`;
}

export function salonPulse(input: {
  month: number; lastSameSpan: number; series: number[]; createdAt: Date; now: Date;
  spendCents: number; adsBookings: number; lastSpendMonth: string | null;
}): SalonPulse {
  const ageDays = Math.floor((input.now.getTime() - input.createdAt.getTime()) / 86_400_000);
  const growth = growthVerdict({ month: input.month, lastSameSpan: input.lastSameSpan }, ageDays);
  const lastMonth = input.series.length >= 2 ? input.series[input.series.length - 2] : 0;
  const bookings: PulseBookings = {
    month: input.month,
    lastSameSpan: input.lastSameSpan,
    lastMonth,
    series: input.series,
    pct: growth.kind === 'thin' ? null : pctChange(input.month, input.lastSameSpan),
  };
  const ads = adsVerdict({ spendCents: input.spendCents, bookings: input.adsBookings, lastSpendMonth: input.lastSpendMonth }, monthWindows(input.now).key);
  return { bookings, growth, ads };
}
