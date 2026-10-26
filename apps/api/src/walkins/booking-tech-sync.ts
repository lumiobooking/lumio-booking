/**
 * ONE VISIT, ONE TECHNICIAN — ON THE CALENDAR AND ON THE FLOOR.
 *
 * A booked client who has arrived lives in two rows: the booking (calendar,
 * the tech's schedule) and the floor ticket (the tech's "Right now" card, her
 * turn, who may write the SOAP note). The desk could change the technician in
 * either place and only that row changed: "chuyển lịch qua thợ khác thì thợ cũ
 * vẫn còn thông tin, thợ mới không điền được SOAP note — mọi thứ vẫn nằm ở thợ
 * cũ". These two pure rules keep them together:
 *
 *  - calendar → floor (handLegsTo): the parts of the visit still to do or in
 *    progress that were the old tech's go to the new one, pinned (the
 *    dispatcher never moves them back). The clock of a part in progress keeps
 *    running. A finished part keeps who did it — her turn and her money.
 *  - floor → calendar (bookingTechAfter): when the booking's tech no longer
 *    has any part of the ticket, the booking shows the tech who took her part
 *    over (else whoever is on the client now).
 */
import { legsOf, patchLeg, type Leg, type LegItem, type TicketLike } from './walkin-legs';

/** Which parts move. `serviceId` limits it to the part carrying that service (a booking line's own tech). */
export function handLegsTo(
  t: TicketLike,
  items: LegItem[],
  from: string | null,
  to: string,
  serviceId?: string,
): { items: LegItem[]; moved: Leg[] } {
  const open = legsOf({ ...t, items }).filter((l) => l.status !== 'DONE' && l.staffId !== to);
  let pick: Leg[];
  if (serviceId) {
    pick = open.filter((l) => l.serviceIds.includes(serviceId));
  } else {
    pick = open.filter((l) => !!from && l.staffId === from);
    // The booking had nobody (or the old tech holds no part): the parts nobody has yet.
    if (!pick.length) pick = open.filter((l) => !l.staffId);
  }
  let next = items;
  for (const l of pick) next = patchLeg(next, l.legId, { staffId: to, pinned: true });
  return { items: next, moved: pick };
}

/** The tech the booking should now show, or null to leave it as it is. */
export function bookingTechAfter(before: TicketLike, after: LegItem[], bookingStaffId: string | null): string | null {
  const now = legsOf({ ...before, items: after });
  const onTicket = new Set(now.map((l) => l.staffId).filter((x): x is string => !!x));
  if (bookingStaffId && onTicket.has(bookingStaffId)) return null;
  const hers = new Set(bookingStaffId ? legsOf(before).filter((l) => l.staffId === bookingStaffId).map((l) => l.legId) : []);
  const heir = now.find((l) => hers.has(l.legId) && l.staffId)?.staffId;
  const serving = now.find((l) => l.status === 'SERVING' && l.staffId)?.staffId;
  const anyone = now.find((l) => l.status !== 'DONE' && l.staffId)?.staffId;
  const next = heir ?? serving ?? anyone ?? null;
  return next && next !== bookingStaffId ? next : null;
}
