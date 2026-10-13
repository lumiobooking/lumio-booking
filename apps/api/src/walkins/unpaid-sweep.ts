/**
 * A NEW DAY STARTS WITH AN EMPTY "CHỜ TÍNH TIỀN".
 *
 * A visit parked at the till ("waiting to pay") stayed there until someone
 * rang it up — so a salon that settles outside Lumio, or simply forgets, saw
 * the column grow day after day (37 names, most of them from last week). A
 * parked ticket with no doneAt also counted as a turn TODAY for its
 * technician, every day it sat there.
 *
 * Once the salon's day has moved on, such a visit is closed as Done ON ITS OWN
 * DAY: doneAt = the last moment anything happened on it (a leg finishing or
 * starting, the seat, the ticket). No order is written, so no revenue; the
 * turn lands on the day the work was done. The board lists it for a week under
 * "Chưa tính tiền ngày trước", from where the till can still ring it up.
 *
 * Pure: the caller supplies the salon's day of an instant.
 */
import { legsOf, type TicketLike } from './walkin-legs';

export interface UnpaidClose { id: string; doneAt: Date }

/** How long the board keeps listing visits closed without a payment. */
export const UNPAID_LIST_DAYS = 7;

const ms = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? null : n;
};

/** The last moment anything happened on the visit. */
export function lastActivity(t: TicketLike): Date {
  let best = ms(t.assignedAt) ?? ms(t.createdAt) ?? 0;
  for (const leg of legsOf(t)) {
    for (const v of [ms(leg.doneAt), ms(leg.startedAt)]) if (v !== null && v > best) best = v;
  }
  return new Date(best);
}

/** Parked visits whose last activity is on a day before today (salon days, 'YYYY-MM-DD'). */
export function unpaidFromPastDays(tickets: TicketLike[], todayKey: string, dayOf: (d: Date) => string): UnpaidClose[] {
  const out: UnpaidClose[] = [];
  for (const t of tickets) {
    if (t.status !== 'SERVING' || !t.awaitingPayment) continue;
    const at = lastActivity(t);
    if (dayOf(at) < todayKey) out.push({ id: t.id, doneAt: at });
  }
  return out;
}

/** Order rows → the walk-in ids they settled (whole ticket, party, or line by line). */
export function settledWalkIns(orders: { walkInId?: string | null; walkInIds?: string[] | null; items?: { walkInId?: string | null }[] | null }[]): Set<string> {
  const s = new Set<string>();
  for (const o of orders) {
    if (o.walkInId) s.add(o.walkInId);
    for (const id of o.walkInIds ?? []) s.add(id);
    for (const it of o.items ?? []) if (it.walkInId) s.add(it.walkInId);
  }
  return s;
}
