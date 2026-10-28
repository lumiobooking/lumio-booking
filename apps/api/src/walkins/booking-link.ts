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

/** What the ticket knows about who walked in, when there is no customer record to go by. */
export interface WalkInWho {
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Last ten digits — "+1 (512) 886-8189" and "5128868189" are one phone. */
export const phoneKey = (v: string | null | undefined): string => String(v ?? '').replace(/\D/g, '').slice(-10);
/** Lower case, no accents, single spaces — "Ngọc  Anh" and "ngoc anh" are one name. */
export const nameKey = (v: string | null | undefined): string =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
/** Names the desk or the kiosk fills in when it does not know one — never evidence of who it is. */
const PLACEHOLDER = /^(?:walk[\s-]?in|guest(?:\s*\d+)?|khach(?:\s*\d+)?|khach le|customer|client|n\/?a|-+)$/i;

type Candidate = { id: string; startTime: Date; status: string; customerId: string | null; customer?: { phone?: string | null; firstName?: string | null; lastName?: string | null } | null };

/**
 * The booking this walk-in IS, when the ticket has no customer record that
 * matches one: the same phone on the booking's customer, or — when either side
 * has no phone — the same name, and only when exactly ONE open booking near now
 * carries it (two "Anna"s at 2pm is a question for the desk, not a guess).
 */
export function pickBookingByContact(appts: Candidate[], who: WalkInWho, now: Date, windowMin = LINK_WINDOW_MIN): string | null {
  const near = appts.filter((a) => (OPEN as unknown as string[]).includes(a.status) && Math.abs(new Date(a.startTime).getTime() - now.getTime()) <= windowMin * 60000);
  const nearest = (xs: Candidate[]) => xs.sort((a, b) => Math.abs(+new Date(a.startTime) - +now) - Math.abs(+new Date(b.startTime) - +now))[0]?.id ?? null;
  const ph = phoneKey(who.phone);
  if (ph.length >= 7) {
    const byPhone = near.filter((a) => { const k = phoneKey(a.customer?.phone); return k.length >= 7 && k === ph; });
    if (byPhone.length) return nearest(byPhone);
  }
  const first = nameKey(who.firstName);
  if (!first || PLACEHOLDER.test(first)) return null;
  const last = nameKey(who.lastName);
  const byName = near.filter((a) => {
    // Two different phones are two different people, whatever the name says.
    const theirs = phoneKey(a.customer?.phone);
    if (ph.length >= 7 && theirs.length >= 7) return false;
    const f = nameKey(a.customer?.firstName);
    if (!f || f !== first) return false;
    const l = nameKey(a.customer?.lastName);
    return !(last && l && l !== last);
  });
  return byName.length === 1 ? byName[0].id : null;
}

/**
 * At check-in: the customer's open booking near now becomes this ticket's booking.
 *
 * By her customer record first; failing that by the phone or name the desk or
 * the kiosk typed (`who`) — a booking taken by phone with only a first name,
 * then a check-in with a phone number, made two records and the booking sat
 * Pending while she was in the chair.
 */
export async function linkWalkInToBooking(db: Db, tenantId: string, walkInId: string, customerId: string | null, now = new Date(), who?: WalkInWho | null): Promise<string | null> {
  const lo = new Date(now.getTime() - LINK_WINDOW_MIN * 60000);
  const hi = new Date(now.getTime() + LINK_WINDOW_MIN * 60000);
  if (customerId) {
    const appts = (await db.appointment.findMany({
      where: { tenantId, customerId, status: { in: OPEN }, startTime: { gte: lo, lte: hi } },
      select: { id: true, startTime: true, status: true },
    })) as { id: string; startTime: Date; status: string }[];
    const id = pickOpenBooking(appts, now);
    if (id && (await pairTicketWithBooking(db, tenantId, walkInId, id, now))) return id;
  }
  if (!who || (!phoneKey(who.phone) && !nameKey(who.firstName))) return null;
  // Open bookings near now that are not on the floor yet — a handful per salon.
  const near = (await db.appointment.findMany({
    where: { tenantId, status: { in: OPEN }, startTime: { gte: lo, lte: hi } },
    select: { id: true, startTime: true, status: true, customerId: true, customer: { select: { phone: true, firstName: true, lastName: true } } },
    take: 300,
  })) as Candidate[];
  // A booking under ANOTHER record is taken only on that evidence: the same
  // phone, or a unique name where at most one side has a phone — the usual
  // duplicate (booked by phone as "Anna", checked in with her number).
  const id = pickBookingByContact(near, who, now);
  if (!id) return null;
  return (await pairTicketWithBooking(db, tenantId, walkInId, id, now)) ? id : null;
}

/**
 * The rest of a PARTY. The booker's ticket found her booking; the friends who
 * came with her are tickets with no customer record, so nothing tied them to
 * the friends' bookings in the same group — those sat Pending and the midnight
 * sweep marked them no-shows. Pair them in order, one ticket per booking.
 */
export async function linkPartyToGroup(db: Db & { appointment: { findFirst?: (a: unknown) => Promise<unknown> } }, tenantId: string, leadAppointmentId: string | null, guestWalkInIds: string[], now = new Date()): Promise<string[]> {
  if (!leadAppointmentId || !guestWalkInIds.length || typeof db.appointment.findFirst !== 'function') return [];
  const lead = (await db.appointment.findFirst({ where: { id: leadAppointmentId, tenantId }, select: { groupId: true } })) as { groupId?: string | null } | null;
  if (!lead?.groupId) return [];
  const rest = (await db.appointment.findMany({
    where: { tenantId, groupId: lead.groupId, id: { not: leadAppointmentId }, status: { in: OPEN } },
    select: { id: true, startTime: true, status: true },
    orderBy: { createdAt: 'asc' },
  })) as { id: string }[];
  const out: string[] = [];
  const free = [...guestWalkInIds];
  for (const appt of rest) {
    if (!free.length) break;
    // A friend already checked in on her own keeps her own ticket.
    if (await db.walkIn.findFirst({ where: { tenantId, appointmentId: appt.id, status: { not: 'CANCELLED' } }, select: { id: true } })) continue;
    while (free.length) {
      const w = free.shift()!;
      if (await pairTicketWithBooking(db, tenantId, w, appt.id, now)) { out.push(appt.id); break; }
    }
  }
  return out;
}
