/**
 * What a new customer spends — before this salon has any bookings with us.
 *
 * WHAT WAS WRONG
 *
 * The ad budget was sized from one number: the average ticket, measured from
 * appointments already in OUR system. That is the best possible source, and it
 * is unavailable in three of the most common situations this agency meets:
 *
 *   1. A salon that joined last week. It has customers; it has no history HERE.
 *   2. A salon opening next month. It will never have history before it opens,
 *      and the month before opening is exactly when it wants to advertise.
 *   3. A salon that has traded for nine years on somebody else's booking
 *      system. An established business, and to us it looks like a blank page.
 *
 * All three read the same sentence — "not enough appointments yet, a few more
 * weeks and we can work it out" — which is true about our data and false about
 * the business. A shop that has been open since 2017 is not "a few weeks" away
 * from knowing what a manicure costs.
 *
 * WHAT REPLACES IT
 *
 * A salon that has finished setup has typed its own menu in, with prices. That
 * menu is a statement by the business about what a visit costs, made before any
 * of this mattered, and it is available on day one — including for a salon that
 * has not opened yet.
 *
 * WHY THE MEDIAN, NOT THE AVERAGE
 *
 * A nail menu runs from a $15 polish change to a $120 full set with art. The
 * mean is dragged around by whichever end of that the salon happens to have
 * more of; the median is what a normal visit costs, which is the question. Rows
 * shorter than MIN_VISIT_MINUTES are dropped first — a ten-minute add-on is a
 * line on a bill, never a visit on its own, and a menu with thirty of them
 * would otherwise halve the estimate.
 *
 * WHAT THIS IS NOT
 *
 * It is not a measurement, and nothing that consumes it may present it as one.
 * `source` travels with the number for exactly that reason: a budget built on
 * a price list has to say so on the screen, or the first time reality disagrees
 * the salon is right to stop believing the rest of the numbers too.
 */

export type TicketSource =
  /** Measured: what first-time customers actually paid here. */
  | 'first-visits'
  /** Measured: the average across this salon's customers. */
  | 'all-visits'
  /** Estimated: the middle of the salon's own price list. */
  | 'menu'
  /** Nothing to go on. */
  | 'none';

export interface TicketEstimate {
  cents: number | null;
  source: TicketSource;
  /** How many data points stand behind it — appointments, or priced services. */
  basis: number;
}

export interface MenuRow {
  priceCents?: number | null;
  durationMinutes?: number | null;
}

/** Below this, a row is an add-on to another service, not a visit. */
export const MIN_VISIT_MINUTES = 20;

/** The middle value; for an even count, the lower of the two middles — an
 *  estimate that leans low is the one that will not overspend somebody's money. */
export function medianCents(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** A typical visit, read off the salon's own menu. */
export function menuTicket(services: MenuRow[] | null | undefined): TicketEstimate {
  const priced = (services ?? [])
    .filter((s) => Number(s?.priceCents ?? 0) > 0)
    .filter((s) => Number(s?.durationMinutes ?? 0) >= MIN_VISIT_MINUTES)
    .map((s) => Number(s.priceCents));
  // A menu of nothing but add-ons is still a menu: rather than answer "none",
  // fall back to every priced row, which is worse but true.
  const pool = priced.length
    ? priced
    : (services ?? []).filter((s) => Number(s?.priceCents ?? 0) > 0).map((s) => Number(s.priceCents));
  const cents = medianCents(pool);
  return cents ? { cents, source: 'menu', basis: pool.length } : { cents: null, source: 'none', basis: 0 };
}

/**
 * The best answer available, and an honest label for where it came from.
 *
 * Measured always beats estimated — a salon with real first visits here does
 * not get a guess from its price list.
 */
export function estimateTicket(input: {
  firstVisitCents?: number | null;
  firstVisitCount?: number | null;
  anySegmentCents?: number | null;
  anySegmentCount?: number | null;
  services?: MenuRow[] | null;
}): TicketEstimate {
  const first = Number(input.firstVisitCents ?? 0);
  if (first > 0) return { cents: Math.round(first), source: 'first-visits', basis: Number(input.firstVisitCount ?? 0) };
  const any = Number(input.anySegmentCents ?? 0);
  if (any > 0) return { cents: Math.round(any), source: 'all-visits', basis: Number(input.anySegmentCount ?? 0) };
  return menuTicket(input.services);
}

/** True when the number is a reading of the price list rather than of reality. */
export function isEstimate(source: TicketSource): boolean {
  return source === 'menu';
}
