/**
 * What a service costs a customer who walks in TODAY — the one rule, in one
 * place, for the kiosk screen and for the ticket it creates.
 *
 * WHY THIS FILE EXISTS
 *
 * The check-in screen and the walk-in ticket priced the same service two
 * different ways. The screen showed the list price; the ticket applied the
 * service's own discount. So a customer read $65 on the kiosk and $52 on the
 * receipt — not a cent lost, but the offer that was supposed to make her
 * pick the Gel-X set was invisible at the only moment it mattered, and the
 * salon's weekday promotion ("15% off pedicures on Tuesdays") was applied
 * nowhere at all on a walk-in, only on an online booking.
 *
 * THE RULE, COPIED FROM THE BOOKING PAGE SO THE TWO CAN NEVER DRIFT
 *
 * A service's own discount comes off first. Then the best promotion that
 * covers today and the service's category — weekday rule or date rule,
 * whichever is higher, never both — comes off the result. That is exactly
 * what apps/web's booking page does in svcNetCents + promoPctFor, and a
 * walk-in must not be quoted differently from a booking for the same chair
 * on the same day.
 *
 * Pure: no clock, no database. The caller says what day it is, in the
 * salon's own timezone, because "today" on a server in Oregon is not today
 * in a salon in Houston at 11 pm.
 */

export interface WeekdayRule { day: number; categoryId: string | null; percent: number }
export interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }
export interface PromoSettings {
  weekday?: { enabled?: boolean; message?: string; rules?: WeekdayRule[] } | null;
  dates?: { enabled?: boolean; rules?: DateRule[] } | null;
}

/** Today, as the salon sees it. */
export interface SalonDay {
  /** YYYY-MM-DD in the salon's timezone. */
  dayKey: string;
  /** 0 = Sunday … 6 = Saturday, salon-local. */
  weekday: number;
}

const pct = (n: unknown) => Math.min(90, Math.max(0, Math.round(Number(n) || 0)));

/** The best weekday % for today and this category. */
export function weekdayPct(p: PromoSettings, day: SalonDay, categoryId: string | null): number {
  const wd = p.weekday;
  if (!wd?.enabled || !Array.isArray(wd.rules)) return 0;
  let best = 0;
  for (const r of wd.rules) {
    if (r.day !== day.weekday) continue;
    if (r.categoryId && r.categoryId !== categoryId) continue;
    if (r.percent > best) best = r.percent;
  }
  return pct(best);
}

/** The best date-range % for today and this category. */
export function datePct(p: PromoSettings, day: SalonDay, categoryId: string | null): number {
  const dd = p.dates;
  if (!dd?.enabled || !Array.isArray(dd.rules)) return 0;
  let best = 0;
  for (const r of dd.rules) {
    if (!r?.startDate) continue;
    if (categoryId && r.categoryId && r.categoryId !== categoryId) continue;
    const end = r.endDate || r.startDate;
    if (r.startDate <= day.dayKey && day.dayKey <= end && r.percent > best) best = r.percent;
  }
  return pct(best);
}

/** Weekday or date, whichever is higher. Never stacked. */
export function promoPct(p: PromoSettings, day: SalonDay, categoryId: string | null): number {
  return Math.max(weekdayPct(p, day, categoryId), datePct(p, day, categoryId));
}

/**
 * The price the customer pays: own discount first, then today's promotion on
 * what is left. Integer cents, rounded once per step — the same two roundings
 * the booking page does, so both screens print the same figure.
 */
export function netCents(priceCents: number, discountPercent: number, promo: number): number {
  const own = pct(discountPercent);
  const afterOwn = own > 0 ? Math.round((priceCents * (100 - own)) / 100) : priceCents;
  const pr = pct(promo);
  return pr > 0 ? Math.round((afterOwn * (100 - pr)) / 100) : afterOwn;
}

export interface PricedService {
  id: string;
  name: string;
  priceCents: number;
  /** The service's own discount, 0–90. */
  discountPercent: number;
  /** Today's promotion for this service's category, 0–90. */
  promoPercent: number;
  /** What the customer pays today. Equal to priceCents when nothing applies. */
  netCents: number;
  durationMinutes: number;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
}

export function priceService(
  s: { id: string; name: string; priceCents: number; discountPercent?: number | null; durationMinutes: number; isFeatured?: boolean | null; category?: { id: string; name: string } | null },
  p: PromoSettings,
  day: SalonDay,
): PricedService {
  const promo = promoPct(p, day, s.category?.id ?? null);
  const own = pct(s.discountPercent);
  return {
    id: s.id,
    name: s.name,
    priceCents: s.priceCents,
    discountPercent: own,
    promoPercent: promo,
    netCents: netCents(s.priceCents, own, promo),
    durationMinutes: s.durationMinutes,
    isFeatured: s.isFeatured === true,
    category: s.category ?? null,
  };
}

/**
 * The band at the top of the screen: is there a promotion running today, and
 * what should it say? Null when nothing applies, so the screen draws nothing
 * rather than an empty orange box.
 *
 * `label` is the salon's own words when it wrote any (the weekday headline or
 * a date rule's name); `scope` tells the screen whether to say "all services"
 * or name the category. The percent is the best one running today for ANY
 * category, which is what a banner should shout — the exact figure per
 * service is on the service.
 */
export function promoBanner(
  p: PromoSettings,
  day: SalonDay,
  categories: { id: string; name: string }[],
): { percent: number; label: string | null; scope: 'all' | string } | null {
  let best = { percent: 0, label: null as string | null, scope: 'all' as 'all' | string };
  const consider = (percent: number, label: string | null, scope: 'all' | string) => {
    // Higher wins; on a tie the broader claim wins, because "15% off
    // everything" is the sentence worth a banner and "15% off pedicures" is
    // already printed on every pedicure.
    if (percent > best.percent || (percent === best.percent && percent > 0 && scope === 'all' && best.scope !== 'all')) {
      best = { percent, label, scope };
    }
  };
  const wd = p.weekday;
  if (wd?.enabled && Array.isArray(wd.rules)) {
    for (const r of wd.rules) {
      if (r.day !== day.weekday) continue;
      const scope = r.categoryId ? (categories.find((c) => c.id === r.categoryId)?.name ?? null) : 'all';
      if (scope === null) continue; // a rule for a category no longer on the menu
      consider(pct(r.percent), wd.message?.trim() || null, scope);
    }
  }
  const dd = p.dates;
  if (dd?.enabled && Array.isArray(dd.rules)) {
    for (const r of dd.rules) {
      if (!r?.startDate) continue;
      const end = r.endDate || r.startDate;
      if (!(r.startDate <= day.dayKey && day.dayKey <= end)) continue;
      const scope = r.categoryId ? (categories.find((c) => c.id === r.categoryId)?.name ?? null) : 'all';
      if (scope === null) continue;
      consider(pct(r.percent), r.label?.trim() || null, scope);
    }
  }
  return best.percent > 0 ? best : null;
}
