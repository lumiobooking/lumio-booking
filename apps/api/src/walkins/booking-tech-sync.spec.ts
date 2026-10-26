/**
 * Changing the technician of a booked client who is already in the salon:
 * the calendar and the floor ticket must say the same person.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    AppointmentStatus: actual.AppointmentStatus ?? { CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED', ARRIVED: 'ARRIVED' },
  };
});
import { bookingTechAfter, handLegsTo } from './booking-tech-sync';
import { WalkinsService } from './walkins.service';
import type { LegItem, TicketLike } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const line = (legId: string, serviceId: string, staffId: string | null, legStatus: string): LegItem =>
  ({ lineId: `l-${legId}-${serviceId}`, legId, serviceId, name: serviceId, priceCents: 1000, staffId, legStatus } as LegItem);
const t = (items: LegItem[]): TicketLike => ({ id: 'w1', status: 'SERVING', assignedStaffId: items[0]?.staffId ?? null, createdAt: new Date(), items });

describe('calendar → floor (handLegsTo)', () => {
  it('the part in progress moves to the new tech, pinned, clock kept', () => {
    const items = [{ ...line('g1', 'ritual', 'old', 'SERVING'), startedAt: '2026-10-25T20:00:00Z' }];
    const r = handLegsTo(t(items), items, 'old', 'new');
    expect(r.moved.map((l) => l.legId)).toEqual(['g1']);
    expect(r.items[0]).toMatchObject({ staffId: 'new', pinned: true, legStatus: 'SERVING', startedAt: '2026-10-25T20:00:00Z' });
  });
  it('a finished part keeps who did it; a colleague\'s part is left alone', () => {
    const items = [line('g1', 'mani', 'old', 'DONE'), line('g2', 'pedi', 'old', 'WAITING'), line('g3', 'wax', 'kim', 'SERVING')];
    const r = handLegsTo(t(items), items, 'old', 'new');
    expect(r.items.map((i) => i.staffId)).toEqual(['old', 'new', 'kim']);
  });
  it('a booking line given to a tech moves only the part carrying that service', () => {
    const items = [line('g1', 'mani', 'old', 'SERVING'), line('g2', 'pedi', null, 'WAITING')];
    const r = handLegsTo(t(items), items, null, 'kim', 'pedi');
    expect(r.items.map((i) => i.staffId)).toEqual(['old', 'kim']);
  });
  it('the booking had nobody: the unassigned parts go to the new tech', () => {
    const items = [line('g1', 'mani', null, 'WAITING')];
    expect(handLegsTo(t(items), items, null, 'new').items[0].staffId).toBe('new');
  });
});

describe('floor → calendar (bookingTechAfter)', () => {
  it('the desk hands the client to another tech on the floor: the booking follows', () => {
    const before = [line('g1', 'ritual', 'old', 'SERVING')];
    const after = [line('g1', 'ritual', 'new', 'SERVING')];
    expect(bookingTechAfter(t(before), after, 'old')).toBe('new');
  });
  it('the booking\'s tech still has a part: nothing changes', () => {
    const before = [line('g1', 'mani', 'old', 'SERVING'), line('g2', 'pedi', null, 'WAITING')];
    const after = [line('g1', 'mani', 'old', 'SERVING'), line('g2', 'pedi', 'kim', 'SERVING')];
    expect(bookingTechAfter(t(before), after, 'old')).toBeNull();
  });
  it('her part went back to the queue: nobody to show yet, the booking is left as is', () => {
    const before = [line('g1', 'mani', 'old', 'SERVING')];
    const after = [line('g1', 'mani', null, 'WAITING')];
    expect(bookingTechAfter(t(before), after, 'old')).toBeNull();
  });
});

describe('followBooking on the service', () => {
  function make() {
    const ticket = { id: 'w1', tenantId: 'A', appointmentId: 'b1', customerName: 'Jennifer', assignedStaffId: 'old', status: 'SERVING', createdAt: new Date(),
      items: [line('g1', 'ritual', 'old', 'SERVING')] };
    const writes: Row[] = [];
    const prisma: Row = {
      walkIn: {
        findFirst: async ({ where }: Row) => (where.tenantId === 'A' && where.appointmentId === 'b1' ? ticket : null),
        updateMany: async (a: Row) => { writes.push(a); return { count: 1 }; },
      },
      appointment: {
        findFirst: async () => ({ assignedStaffId: 'new' }), // the booking was already moved
        updateMany: async (a: Row) => { writes.push({ appointment: a }); return { count: 1 }; },
      },
    };
    const svc = new WalkinsService(prisma as never, {} as never, {} as never);
    (svc as unknown as Row).settle = async () => undefined;
    return { svc, writes };
  }
  it('the new tech gets the client in her chair; the booking is not written back', async () => {
    const { svc, writes } = make();
    expect(await svc.followBooking('A', 'b1', 'old', 'new')).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].where).toEqual({ id: 'w1', tenantId: 'A' });
    expect(writes[0].data.assignedStaffId).toBe('new');
    expect(writes[0].data.items[0]).toMatchObject({ staffId: 'new', pinned: true });
  });
  it('another salon never reaches this ticket', async () => {
    const { svc, writes } = make();
    expect(await svc.followBooking('B', 'b1', 'old', 'new')).toBe(false);
    expect(writes).toEqual([]);
  });
});
