/**
 * WHERE A PROMOTION APPLIES.
 *
 * A salon runs a sale for one of three audiences, and the owner has to be
 * able to say which:
 *
 *   'all'     the whole salon: customers who book online, bookings the desk
 *             takes for a caller, and walk-ins (desk + QR check-in);
 *   'online'  only customers who book THEMSELVES online — the booking page,
 *             the WordPress plugin, Google, the chat bot, the AI phone line;
 *   'walkin'  only walk-ins — added at the desk or checked in on the kiosk.
 *
 * A booking the front desk makes for a caller is neither "online" nor a
 * walk-in: it gets a promotion only when that promotion is for the whole
 * salon.
 *
 * Every promotion saved before this existed has no `appliesTo`; it reads as
 * 'all', which is what the booking page and the check-in kiosk already did
 * with it.
 *
 * Pure: no database, no clock (tested in promo-channel.spec.ts).
 */

export type PromoChannel = 'all' | 'online' | 'walkin';
/** Where a sale is happening. */
export type SaleChannel = 'online' | 'desk' | 'walkin';

export const PROMO_CHANNELS: readonly PromoChannel[] = ['all', 'online', 'walkin'];

/** A saved or posted value, as one of the three. Anything else → the fallback. */
export function cleanChannel(v: unknown, fallback: PromoChannel = 'all'): PromoChannel {
  return v === 'all' || v === 'online' || v === 'walkin' ? v : fallback;
}

/** The audience of a programme or a rule (missing = the whole salon). */
export function channelOf(x: unknown): PromoChannel {
  return cleanChannel(x && typeof x === 'object' ? (x as { appliesTo?: unknown }).appliesTo : undefined, 'all');
}

/** Does this programme / rule apply to a sale made here? */
export function appliesOn(x: unknown, where: SaleChannel): boolean {
  const c = channelOf(x);
  return c === 'all' || c === where;
}

/**
 * The channel a booking was MADE on, from its stored `source`.
 * The desk ('admin', 'pos', or nothing at all on old rows) and walk-ins are
 * the salon's own; every other source is the customer booking herself.
 */
export function channelOfSource(source: string | null | undefined): SaleChannel {
  const s = String(source ?? '').trim().toLowerCase();
  if (!s || s === 'admin' || s === 'pos' || s === 'desk' || s === 'staff' || s === 'manual') return 'desk';
  if (s === 'walkin' || s === 'walk-in' || s === 'kiosk' || s === 'retail' || s === 'counter') return 'walkin';
  return 'online';
}

/** A whole programme (weekday, first visit, group) as seen from one channel: off when it is not for it. */
export function programFor<T extends object>(p: T | null | undefined, where: SaleChannel): T | null | undefined {
  if (!p) return p;
  return appliesOn(p, where) ? p : { ...p, enabled: false };
}

/** Date rules as seen from one channel: only the rules meant for it. */
export function dateRulesFor<R, T extends { rules?: R[] | null }>(d: T | null | undefined, where: SaleChannel): T | null | undefined {
  if (!d) return d;
  return { ...d, rules: (Array.isArray(d.rules) ? d.rules : []).filter((r) => appliesOn(r, where)) };
}

/** "khi đặt online" / "for walk-ins" — what a post or a banner adds after the %. Empty for the whole salon. */
export function channelSuffix(x: unknown, vi: boolean): string {
  const c = channelOf(x);
  if (c === 'online') return vi ? ' khi đặt lịch online' : ' when you book online';
  if (c === 'walkin') return vi ? ' cho khách walk-in' : ' for walk-ins';
  return '';
}
