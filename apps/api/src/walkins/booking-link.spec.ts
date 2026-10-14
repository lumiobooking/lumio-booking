/**
 * A booked customer added as a walk-in (desk or tablet) is that booking — and
 * the midnight sweep never calls a customer who was served a no-show. In her
 * own salon only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', NO_SHOW: 'NO_SHOW', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', REJECTED: 'REJECTED' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { linkWalkInToBooking, matchMissedToVisits, pickOpenBooking } from './booking-link';
import { BookingsService } from '../bookings/bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-12T17:00:00Z');
const chicago = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function db(appts: Row[], tickets: Row[]) {
  const matches = (r: Row, w: Row) => Object.entries(w).every(([k, c]) => {
    const v = r[k];
    if (c && typeof c === 'object' && !(c instanceof Date)) {
      if ('in' in c) return (c.in as unknown[]).includes(v);
      if ('not' in c) return v !== c.not;
      if ('gte' in c) return v >= c.gte && (!('lte' in c) || v <= c.lte) && (!('lt' in c) || v < c.lt);
      return true;
    }
    return v === c;
  });
  return {
    appointment: {
      findMany: async ({ where }: Row) => appts.filter((a) => matches(a, where)),
      updateMany: async ({ where, data }: Row) => { const hit = appts.filter((a) => matches(a, where)); hit.forEach((a) => Object.assign(a, data)); return { count: hit.length }; },
    },
    walkIn: {
      findFirst: async ({ where }: Row) => tickets.find((t) => matches(t, where)) ?? null,
      findMany: async ({ where }: Row) => tickets.filter((t) => matches(t, where)),
      updateMany: async ({ where, data }: Row) => { const hit = tickets.filter((t) => matches(t, where)); hit.forEach((t) => Object.assign(t, data)); return { count: hit.length }; },
    },
  };
}

describe('picking the booking a walk-in is', () => {
  it('the open booking nearest now within two hours; never a far one or a closed one', () => {
    expect(pickOpenBooking([
      { id: 'later', startTime: new Date('2026-10-12T21:00:00Z'), status: 'CONFIRMED' },
      { id: 'near', startTime: new Date('2026-10-12T17:30:00Z'), status: 'CONFIRMED' },
      { id: 'gone', startTime: new Date('2026-10-12T17:05:00Z'), status: 'CANCELLED' },
    ], NOW)).toBe('near');
    expect(pickOpenBooking([{ id: 'far', startTime: new Date('2026-10-12T21:00:00Z'), status: 'CONFIRMED' }], NOW)).toBeNull();
  });

  it('at check-in: the ticket carries the booking and the booking is ARRIVED; another salon is untouched', async () => {
    const appts = [
      { id: 'a1', tenantId: 'A', customerId: 'c1', status: 'CONFIRMED', startTime: new Date('2026-10-12T17:15:00Z') },
      { id: 'b1', tenantId: 'B', customerId: 'c1', status: 'CONFIRMED', startTime: new Date('2026-10-12T17:15:00Z') },
    ];
    const tickets = [{ id: 'w1', tenantId: 'A', customerId: 'c1', appointmentId: null, status: 'WAITING' }];
    const d = db(appts, tickets);
    expect(await linkWalkInToBooking(d as never, 'A', 'w1', 'c1', NOW)).toBe('a1');
    expect(tickets[0].appointmentId).toBe('a1');
    expect(appts[0].status).toBe('ARRIVED');
    expect(appts[1].status).toBe('CONFIRMED');
  });

  it('a booking already on the floor is not tied to a second ticket', async () => {
    const appts = [{ id: 'a1', tenantId: 'A', customerId: 'c1', status: 'CONFIRMED', startTime: NOW }];
    const tickets = [
      { id: 'w0', tenantId: 'A', customerId: 'c1', appointmentId: 'a1', status: 'SERVING' },
      { id: 'w1', tenantId: 'A', customerId: 'c1', appointmentId: null, status: 'WAITING' },
    ];
    expect(await linkWalkInToBooking(db(appts, tickets) as never, 'A', 'w1', 'c1', NOW)).toBeNull();
    expect(tickets[1].appointmentId).toBeNull();
  });

  it('end of day: a same-day ticket of the same customer proves the visit; other days and other customers do not', () => {
    const pairs = matchMissedToVisits(
      [
        { id: 'a1', customerId: 'c1', startTime: new Date('2026-10-12T15:00:00Z') },
        { id: 'a2', customerId: 'c2', startTime: new Date('2026-10-12T15:00:00Z') },
        { id: 'a3', customerId: 'c3', startTime: new Date('2026-10-12T15:00:00Z') },
      ],
      [
        { id: 'w1', customerId: 'c1', createdAt: new Date('2026-10-12T16:10:00Z') },
        { id: 'w2', customerId: 'c2', createdAt: new Date('2026-10-13T16:10:00Z') },
        { id: 'w3', customerId: 'c3', createdAt: new Date('2026-10-12T16:10:00Z'), appointmentId: 'other' },
      ],
      chicago,
    );
    expect(pairs).toEqual([{ appointmentId: 'a1', walkInId: 'w1', at: new Date('2026-10-12T16:10:00Z') }]);
  });
});

describe('the midnight no-show sweep checks the floor first', () => {
  function make(appts: Row[], tickets: Row[]) {
    const d = db(appts, tickets);
    const audits: Row[] = [];
    const prisma: Row = {
      ...d,
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
      appointment: { ...d.appointment },
      auditLog: { findMany: async () => audits.filter((a) => a.action === 'booking.no_show_auto') },
    };
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    (svc as unknown as Row).prisma = prisma;
    (svc as unknown as Row).audit = { log: async (x: Row) => { audits.push(x); } };
    (svc as unknown as Row).logger = { warn: () => undefined, log: () => undefined };
    return { svc, audits };
  }

  it('the customer who came as a walk-in is ARRIVED; the one who never came is NO_SHOW; another salon is untouched', async () => {
    const appts = [
      { id: 'came', tenantId: 'A', customerId: 'c1', status: 'CONFIRMED', startTime: new Date('2026-10-11T15:00:00Z') },
      { id: 'missed', tenantId: 'A', customerId: 'c2', status: 'CONFIRMED', startTime: new Date('2026-10-11T15:00:00Z') },
      { id: 'theirs', tenantId: 'B', customerId: 'c1', status: 'CONFIRMED', startTime: new Date('2026-10-11T15:00:00Z') },
    ];
    const tickets = [{ id: 'w1', tenantId: 'A', customerId: 'c1', appointmentId: null, status: 'DONE', createdAt: new Date('2026-10-11T15:40:00Z') }];
    const { svc, audits } = make(appts, tickets);
    const n = await (svc as unknown as { closeMissed: (t: string, now: Date) => Promise<number> }).closeMissed('A', NOW);
    expect(n).toBe(1);
    expect(appts.find((a) => a.id === 'came')!.status).toBe('ARRIVED');
    expect(tickets[0].appointmentId).toBe('came');
    expect(appts.find((a) => a.id === 'missed')!.status).toBe('NO_SHOW');
    expect(appts.find((a) => a.id === 'theirs')!.status).toBe('CONFIRMED');
    expect(audits.map((a) => a.action).sort()).toEqual(['booking.matched_walkin', 'booking.no_show_auto']);
  });

  it('the repair turns past swept no-shows of customers who were served back to ARRIVED — never a No-show the desk pressed', async () => {
    const appts = [
      { id: 'swept', tenantId: 'A', customerId: 'c1', status: 'NO_SHOW', startTime: new Date('2026-10-01T15:00:00Z') },
      { id: 'pressed', tenantId: 'A', customerId: 'c2', status: 'NO_SHOW', startTime: new Date('2026-10-01T15:00:00Z') },
    ];
    const tickets = [
      { id: 'w1', tenantId: 'A', customerId: 'c1', appointmentId: null, status: 'DONE', createdAt: new Date('2026-10-01T15:30:00Z') },
      { id: 'w2', tenantId: 'A', customerId: 'c2', appointmentId: null, status: 'DONE', createdAt: new Date('2026-10-01T15:30:00Z') },
    ];
    const { svc, audits } = make(appts, tickets);
    audits.push({ tenantId: 'A', action: 'booking.no_show_auto', resourceId: 'swept' });
    const r = await svc.repairFalseNoShows(NOW);
    expect(r.repaired).toBe(1);
    expect(appts[0].status).toBe('ARRIVED');
    expect(appts[1].status).toBe('NO_SHOW');
    expect(tickets[1].appointmentId).toBeNull();
  });
});
