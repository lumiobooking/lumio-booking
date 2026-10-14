/**
 * A BOOKED CUSTOMER WHO WALKS IN IS STILL THE BOOKING.
 *
 * The desk often adds a customer who has an appointment as a plain walk-in
 * ("Thêm khách"), and the tablet's self check-in always does. The ticket was
 * never tied to the booking, so the booking sat open and the midnight sweep
 * marked it NO_SHOW — the report read "6 no-shows" for customers who were in
 * the chair, and those false no-shows fed the deposit / online-blocking rules.
 *
 * Two places now tie them together:
 *  - at check-in: the customer's own open booking within ±2 hours of now
 *    becomes ARRIVED and the ticket carries its appointmentId;
 *  - at the end of the day: before a booking is marked NO_SHOW, a ticket for
 *    the same customer on the same salon day proves she came.
 *
 * Tenant-scoped everywhere; never re-links a ticket or a booking that already
 * has its pair. Pure helpers + one small writer.
 */
import { AppointmentStatus } from '@prisma/client';

export const LINK_WINDOW_MIN = 120;
const OPEN = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'] as unknown as AppointmentStatus[];
const ARRIVED = 'ARRIVED' as unknown as AppointmentStatus;

/** The open booking nearest to now within the window, or null. */
export function pickOpenBooking(appts: { id: string; startTime: Date; status: string }[], now: Date, windowMin = LINK_WINDOW_MIN): string | null {
  let best: { id: string; gap: number } | null = null;
  for (const a of appts) {
    if (!(OPEN as unknown as string[]).includes(a.status)) continue;
    const gap = Math.abs(new Date(a.startTime).getTime() - now.getTime());
    if (gap > windowMin * 60000) continue;
    if (!best || gap < best.gap) best = { id: a.id, gap };
  }
  return best?.id ?? null;
}

/**
 * Missed bookings whose customer has an unlinked, non-cancelled ticket on the
 * same salon day. Each ticket proves at most one booking (the nearest in time).
 */
export function matchMissedToVisits(
  missed: { id: string; customerId: string | null; startTime: Date }[],
  tickets: { id: string; customerId: string | null; createdAt: Date; appointmentId?: string | null; status?: string }[],
  dayOf: (d: Date) => string,
): { appointmentId: string; walkInId: string; at: Date }[] {
  const free = tickets.filter((t) => t.customerId && !t.appointmentId && t.status !== 'CANCELLED');
  const used = new Set<string>();
  const out: { appointmentId: string; walkInId: string; at: Date }[] = [];
  const sorted = [...missed].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
  for (const m of sorted) {
    if (!m.customerId) continue;
    const day = dayOf(new Date(m.startTime));
    let best: { t: (typeof free)[number]; gap: number } | null = null;
    for (const t of free) {
      if (used.has(t.id) || t.customerId !== m.customerId || dayOf(new Date(t.createdAt)) !== day) continue;
      const gap = Math.abs(+new Date(t.createdAt) - +new Date(m.startTime));
      if (!best || gap < best.gap) best = { t, gap };
    }
    if (best) {
      used.add(best.t.id);
      out.push({ appointmentId: m.id, walkInId: best.t.id, at: new Date(best.t.createdAt) });
    }
  }
  return out;
}

type Db = {
  appointment: { findMany: (a: unknown) => Promise<unknown>; updateMany: (a: unknown) => Promise<{ count: number }> };
  walkIn: { findFirst: (a: unknown) => Promise<unknown>; updateMany: (a: unknown) => Promise<{ count: number }> };
};

/** Tie a ticket to its customer's ARRIVED pair. Returns the booking id, or null. */
export async function pairTicketWithBooking(db: Db, tenantId: string, walkInId: string, appointmentId: string, at: Date): Promise<boolean> {
  const taken = await db.walkIn.findFirst({ where: { tenantId, appointmentId, status: { not: 'CANCELLED' } }, select: { id: true } });
  if (taken) return false;
  const w = await db.walkIn.updateMany({ where: { id: walkInId, tenantId, appointmentId: null }, data: { appointmentId } });
  if (!w.count) return false;
  await db.appointment.updateMany({ where: { id: appointmentId, tenantId, status: { in: OPEN } }, data: { status: ARRIVED, arrivedAt: at } });
  return true;
}

/** At check-in: the customer's open booking near now becomes this ticket's booking. */
export async function linkWalkInToBooking(db: Db, tenantId: string, walkInId: string, customerId: string | null, now = new Date()): Promise<string | null> {
  if (!customerId) return null;
  const lo = new Date(now.getTime() - LINK_WINDOW_MIN * 60000);
  const hi = new Date(now.getTime() + LINK_WINDOW_MIN * 60000);
  const appts = (await db.appointment.findMany({
    where: { tenantId, customerId, status: { in: OPEN }, startTime: { gte: lo, lte: hi } },
    select: { id: true, startTime: true, status: true },
  })) as { id: string; startTime: Date; status: string }[];
  const id = pickOpenBooking(appts, now);
  if (!id) return null;
  return (await pairTicketWithBooking(db, tenantId, walkInId, id, now)) ? id : null;
}
