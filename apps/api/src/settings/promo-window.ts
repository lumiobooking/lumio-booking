import { BadRequestException } from '@nestjs/common';

/**
 * When a promotion runs.
 *
 * Every program (weekday, first-visit, group — and each special-date rule)
 * can be bounded by a first and a last day. Both are optional: no start means
 * "from now", no end means "until switched off", which is exactly how every
 * promotion saved before this existed keeps behaving.
 *
 * Days are the SALON's calendar days (YYYY-MM-DD), compared against the day of
 * the appointment — a Grand Opening that ends on the 25th gives its price to
 * visits up to the 25th, whenever they were booked.
 */
export interface PromoWindow {
  startDate?: string | null;
  endDate?: string | null;
}

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** True when `day` (YYYY-MM-DD, salon-local) falls inside the window. */
export function inPromoWindow(w: PromoWindow | null | undefined, day: string): boolean {
  if (!w) return true;
  if (isYmd(w.startDate) && day < w.startDate) return false;
  if (isYmd(w.endDate) && day > w.endDate) return false;
  return true;
}

/** Does the window bound anything at all? (Skip the timezone lookup if not.) */
export function hasPromoWindow(w: PromoWindow | null | undefined): boolean {
  return !!w && (isYmd(w.startDate) || isYmd(w.endDate));
}

/**
 * The window to save. A field the request leaves out keeps its saved value; a
 * field sent empty clears it. An end before the start is refused rather than
 * silently dropped — the owner would otherwise think the sale runs.
 */
export function cleanPromoWindow(
  dto: PromoWindow | null | undefined,
  cur: PromoWindow | null | undefined,
): { startDate: string | null; endDate: string | null } {
  const pick = (k: keyof PromoWindow): string | null => {
    if (dto && k in dto) return isYmd(dto[k]) ? (dto[k] as string) : null;
    return isYmd(cur?.[k]) ? (cur![k] as string) : null;
  };
  const startDate = pick('startDate');
  const endDate = pick('endDate');
  if (startDate && endDate && endDate < startDate) {
    throw new BadRequestException('The end date must be on or after the start date.');
  }
  return { startDate, endDate };
}

/** A salon-local calendar day for an instant. */
export function salonYmd(at: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
