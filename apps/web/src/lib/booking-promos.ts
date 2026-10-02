/**
 * Which promotion a service gets, for the customer's booking page.
 *
 * Mirrors the server (bookings.service promoDiscountPercent /
 * programDiscountPercent): ONE best % per line — the higher of the weekday and
 * special-date rules for the service's category, or the group tier — never
 * stacked. Every program may carry run dates (salon-local YYYY-MM-DD,
 * inclusive); outside them it does not exist.
 *
 * Days here are Date objects at local midnight that stand for the SALON's
 * calendar day (see lib/salon-clock todayInZone), so their local parts are the
 * salon's date.
 *
 * Pure, tested in booking-promos.spec.ts.
 */

export interface PromoWindow { startDate?: string | null; endDate?: string | null }
export interface WdRule { day: number; categoryId: string | null; percent: number }
export interface WeekdayPromo extends PromoWindow { enabled: boolean; message?: string; rules: WdRule[] }
export interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }
export interface DatePromo { enabled: boolean; rules: DateRule[] }
export interface GroupPromo extends PromoWindow { enabled: boolean; message?: string; tiers: { minSize: number; percent: number }[] }
export interface Promos { weekday?: WeekdayPromo; dates?: DatePromo; group?: GroupPromo }

/** A deal on one day: the % and where it came from. */
export interface Deal { pct: number; source: 'weekday' | 'date' | 'group' | null; label: string | null }

const clamp = (n: number) => Math.min(90, Math.max(0, Math.round(n || 0)));
const NONE: Deal = { pct: 0, source: null, label: null };

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function inWindow(w: PromoWindow | null | undefined, day: string): boolean {
  if (!w) return true;
  if (w.startDate && day < w.startDate) return false;
  if (w.endDate && day > w.endDate) return false;
  return true;
}

/** Over for good — nothing to advertise any more. */
export function windowEnded(w: PromoWindow | null | undefined, today: string): boolean {
  return !!w?.endDate && w.endDate < today;
}

export function weekdayDeal(wd: WeekdayPromo | undefined, date: Date, categoryId: string | null | undefined): Deal {
  if (!wd?.enabled || !Array.isArray(wd.rules) || !inWindow(wd, dayKey(date))) return NONE;
  let best = 0;
  for (const r of wd.rules) {
    if (r.day !== date.getDay()) continue;
    if (categoryId !== undefined && categoryId !== null && r.categoryId && r.categoryId !== categoryId) continue;
    if (categoryId === null && r.categoryId) continue;
    if (r.percent > best) best = r.percent;
  }
  return best > 0 ? { pct: clamp(best), source: 'weekday', label: null } : NONE;
}

export function dateDeal(dd: DatePromo | undefined, date: Date, categoryId: string | null | undefined): Deal {
  if (!dd?.enabled || !Array.isArray(dd.rules)) return NONE;
  const s = dayKey(date);
  let best: Deal = NONE;
  for (const r of dd.rules) {
    if (!r?.startDate) continue;
    if (categoryId && r.categoryId && r.categoryId !== categoryId) continue;
    if (categoryId === null && r.categoryId) continue;
    const end = r.endDate || r.startDate;
    if (r.startDate <= s && s <= end && r.percent > best.pct) best = { pct: clamp(r.percent), source: 'date', label: r.label?.trim() || null };
  }
  return best;
}

/** The best weekday/date deal for a service's category on a day. */
export function promoDeal(p: Promos, date: Date | null, categoryId: string | null | undefined): Deal {
  if (!date) return NONE;
  const a = weekdayDeal(p.weekday, date, categoryId);
  const b = dateDeal(p.dates, date, categoryId);
  return b.pct >= a.pct && b.pct > 0 ? b : a;
}

/** Any-category view, for the calendar strip (category ignored). */
export function anyDealPct(p: Promos, date: Date): number {
  return Math.max(weekdayDeal(p.weekday, date, undefined).pct, dateDeal(p.dates, date, undefined).pct);
}

export function groupPct(gr: GroupPromo | undefined, size: number, date: Date | null): number {
  if (!gr?.enabled || size < 2 || !Array.isArray(gr.tiers)) return 0;
  if (date && !inWindow(gr, dayKey(date))) return 0;
  return clamp(gr.tiers.reduce((b, t) => (t.minSize <= size && t.percent > b ? t.percent : b), 0));
}

/** One line's best deal: promo for its category vs the group tier. */
export function lineDeal(p: Promos, date: Date | null, categoryId: string | null | undefined, partySize: number): Deal {
  const promo = promoDeal(p, date, categoryId);
  const g = groupPct(p.group, partySize, date);
  return g > promo.pct ? { pct: g, source: 'group', label: null } : promo;
}

/**
 * The soonest day within `horizon` days (from `from`, inclusive) carrying the
 * BEST deal for this category — what the menu advertises when today has none
 * ("−20% from Oct 10", "−10% on Tue").
 */
export function nextDeal(p: Promos, from: Date, horizon: number, categoryId: string | null | undefined): (Deal & { date: Date }) | null {
  let best: (Deal & { date: Date }) | null = null;
  for (let i = 0; i <= horizon; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const deal = promoDeal(p, d, categoryId);
    if (deal.pct > 0 && (!best || deal.pct > best.pct)) best = { ...deal, date: d };
  }
  return best;
}

/** A price after a % off, in minor units. */
export function afterPct(cents: number, pct: number): number {
  return Math.round((cents * (100 - clamp(pct))) / 100);
}
