/**
 * "Khách tới tiệm walk-in mà vẫn để Pending." Three ways a customer who is IN
 * the salon was left Pending, and the midnight sweep later called her a
 * no-show:
 *   1. the desk booked her at the counter ("Tạo lịch", time = now);
 *   2. she had a booking, the desk added her on the walk-in board with a
 *      name or phone the booking's record did not share;
 *   3. she checked in on the iPad / QR — same, and her friends' bookings in
 *      the same party were never touched.
 * In her own salon only, every time.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', NO_SHOW: 'NO_SHOW', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', REJECTED: 'REJECTED' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { linkPartyToGroup, linkWalkInToBooking, nameKey, phoneKey, pickBookingByContact } from './booking-link';
import { arrivedNowApplies, BookingsService } from '../bookings/bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-28T19:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

function db(appts: Row[], tickets: Row[]) {
  const matches = (r: Row, w: Row) => Object.entries(w).every(([k, c]) => {
    const v = r[k];
    if (c && typeof c === 'object' && !(c instanceof Date)) {
      if ('in' in c) return (c.in as unknown[]).includes(v);
      if ('not' in c) return v !== c.not;
      if ('gte' in c) return v >= c.gte && (!('lte' in c) || v <= c.lte);
      return true;
    }
    return v === c;
  });
  const queries: Row[] = [];
  return {
    _queries: queries,
    appointment: {
      findMany: async ({ where }: Row) => { queries.push(where); return appts.filter((a) => matches(a, where)); },
      findFirst: async ({ where }: Row) => { queries.push(where); return appts.find((a) => matches(a, where)) ?? null; },
      updateMany: async ({ where, data }: Row) => { const hit = appts.filter((a) => matches(a, where)); hit.forEach((a) => Object.assign(a, data)); return { count: hit.length }; },
    },
    walkIn: {
      findFirst: async ({ where }: Row) => tickets.find((t) => matches(t, where)) ?? null,
      updateMany: async ({ where, data }: Row) => { const hit = tickets.filter((t) => matches(t, where)); hit.forEach((t) => Object.assign(t, data)); return { count: hit.length }; },
    },
  };
}
const appt = (id: string, tenantId: string, customer: Row | null, extra: Row = {}) => ({
  id, tenantId, status: 'CONFIRMED', startTime: at(10), customerId: customer?.id ?? null, customer, groupId: null, ...extra,
});

describe('keys', () => {
  it('one phone, one name, however typed', () => {
    expect(phoneKey('+1 (512) 886-8189')).toBe(phoneKey('5128868189'));
    expect(nameKey('  Ngọc   Anh ')).toBe('ngoc anh');
    expect(nameKey('Đào')).toBe('dao');
  });
});

describe('2 + 3: a booked customer checked in under another record is still her booking', () => {
  it('by phone: booked as "Anna" with her number, checked in with a new record', async () => {
    const appts = [appt('a1', 'A', { id: 'old', phone: '+15128868189', firstName: 'Anna' })];
    const tickets = [{ id: 'w1', tenantId: 'A', appointmentId: null, status: 'WAITING' }];
    const d = db(appts, tickets);
    expect(await linkWalkInToBooking(d as never, 'A', 'w1', 'new', NOW, { phone: '(512) 886-8189', firstName: 'Anna' })).toBe('a1');
    expect(appts[0].status).toBe('ARRIVED');
    expect(tickets[0].appointmentId).toBe('a1');
    // Every query fenced to the salon.
    expect(d._queries.every((q) => q.tenantId === 'A')).toBe(true);
  });

  it('by name: a phone booking with no number, a desk walk-in with only a name', async () => {
    const appts = [appt('a1', 'A', { id: 'c1', phone: null, firstName: 'Ngọc', lastName: 'Trần' })];
    const tickets = [{ id: 'w1', tenantId: 'A', appointmentId: null, status: 'WAITING' }];
    expect(await linkWalkInToBooking(db(appts, tickets) as never, 'A', 'w1', null, NOW, { firstName: 'ngoc', lastName: 'tran' })).toBe('a1');
    expect(appts[0].status).toBe('ARRIVED');
  });

  it('never a guess: two of the same name, two different phones, a placeholder, or far from now', () => {
    const two = [appt('a1', 'A', { firstName: 'Anna' }), appt('a2', 'A', { firstName: 'Anna' })];
    expect(pickBookingByContact(two as never, { firstName: 'Anna' }, NOW)).toBeNull();
    const other = [appt('a1', 'A', { firstName: 'Anna', phone: '5125550000' })];
    expect(pickBookingByContact(other as never, { firstName: 'Anna', phone: '5128868189' }, NOW)).toBeNull();
    expect(pickBookingByContact([appt('a1', 'A', { firstName: 'Walk-in' })] as never, { firstName: 'Walk-in' }, NOW)).toBeNull();
    expect(pickBookingByContact([appt('a1', 'A', { firstName: 'Guest 2' })] as never, { firstName: 'Guest 2' }, NOW)).toBeNull();
    expect(pickBookingByContact([appt('a1', 'A', { firstName: 'Anna' }, { startTime: at(300) })] as never, { firstName: 'Anna' }, NOW)).toBeNull();
    expect(pickBookingByContact([appt('a1', 'A', { firstName: 'Anna' }, { status: 'CANCELLED' })] as never, { firstName: 'Anna' }, NOW)).toBeNull();
  });

  it('cross-tenant: the same phone booked at another salon is never touched', async () => {
    const appts = [appt('b1', 'B', { id: 'cb', phone: '5128868189', firstName: 'Anna' })];
    const tickets = [{ id: 'w1', tenantId: 'A', appointmentId: null, status: 'WAITING' }];
    expect(await linkWalkInToBooking(db(appts, tickets) as never, 'A', 'w1', null, NOW, { phone: '5128868189', firstName: 'Anna' })).toBeNull();
    expect(appts[0].status).toBe('CONFIRMED');
    expect(tickets[0].appointmentId).toBeNull();
  });

  it('a booking already on the floor is not given a second ticket', async () => {
    const appts = [appt('a1', 'A', { id: 'c1', phone: '5128868189', firstName: 'Anna' })];
    const tickets = [
      { id: 'w0', tenantId: 'A', appointmentId: 'a1', status: 'SERVING' },
      { id: 'w1', tenantId: 'A', appointmentId: null, status: 'WAITING' },
    ];
    expect(await linkWalkInToBooking(db(appts, tickets) as never, 'A', 'w1', null, NOW, { phone: '5128868189' })).toBeNull();
    expect(tickets[1].appointmentId).toBeNull();
  });

  it('the party: her friends’ bookings in the same group arrive with her', async () => {
    const appts = [
      appt('lead', 'A', { id: 'c1', firstName: 'Anna' }, { groupId: 'g1' }),
      appt('f1', 'A', { firstName: 'Guest 2' }, { groupId: 'g1' }),
      appt('f2', 'A', { firstName: 'Guest 3' }, { groupId: 'g1' }),
      appt('x', 'B', { firstName: 'Guest 2' }, { groupId: 'g1' }), // another salon's id collision
    ];
    const tickets = [
      { id: 'wl', tenantId: 'A', appointmentId: null, status: 'WAITING' },
      { id: 'w2', tenantId: 'A', appointmentId: null, status: 'WAITING' },
      { id: 'w3', tenantId: 'A', appointmentId: null, status: 'WAITING' },
    ];
    const d = db(appts, tickets);
    expect(await linkWalkInToBooking(d as never, 'A', 'wl', 'c1', NOW)).toBe('lead');
    expect(await linkPartyToGroup(d as never, 'A', 'lead', ['w2', 'w3'], NOW)).toEqual(['f1', 'f2']);
    expect(appts.slice(0, 3).map((a) => a.status)).toEqual(['ARRIVED', 'ARRIVED', 'ARRIVED']);
    expect(appts[3].status).toBe('CONFIRMED');
    expect(tickets.map((t) => t.appointmentId)).toEqual(['lead', 'f1', 'f2']);
  });

  it('a friend already on the floor keeps her own ticket', async () => {
    const appts = [appt('lead', 'A', { id: 'c1' }, { groupId: 'g1', status: 'ARRIVED' }), appt('f1', 'A', null, { groupId: 'g1' }), appt('f2', 'A', null, { groupId: 'g1' })];
    const tickets = [
      { id: 'wf1', tenantId: 'A', appointmentId: 'f1', status: 'SERVING' },
      { id: 'w2', tenantId: 'A', appointmentId: null, status: 'WAITING' },
    ];
    expect(await linkPartyToGroup(db(appts, tickets) as never, 'A', 'lead', ['w2'], NOW)).toEqual(['f2']);
    expect(tickets[1].appointmentId).toBe('f2');
  });
});

describe('1: booked at the counter for right now', () => {
  it('only a start near now may be born ARRIVED', () => {
    expect(arrivedNowApplies(NOW, NOW)).toBe(true);
    expect(arrivedNowApplies(at(25), NOW)).toBe(true);
    expect(arrivedNowApplies(at(-180), NOW)).toBe(true);
    expect(arrivedNowApplies(at(45), NOW)).toBe(false);
    expect(arrivedNowApplies(at(-13 * 60), NOW)).toBe(false);
    expect(arrivedNowApplies(new Date('nope'), NOW)).toBe(false);
  });

  function make() {
    const rows: Row[] = [];
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    const createForTenant = jest.fn(async (tenantId: string, dto: Row, _actor: string, _src: unknown, _dev: unknown, opts: Row) => {
      const r = { id: `ap-${rows.length + 1}`, tenantId, status: 'PENDING', startTime: new Date(dto.startTime), dto, opts };
      rows.push(r);
      return r;
    });
    const seatAppointment = jest.fn(async () => ({ id: 'ticket' }));
    Object.assign(svc as unknown as Row, {
      createForTenant,
      walkins: { seatAppointment },
      logger: { warn: jest.fn(), log: jest.fn() },
      audit: { log: jest.fn(async () => undefined) },
      prisma: {
        appointment: {
          updateMany: jest.fn(async ({ where, data }: Row) => {
            const hit = rows.filter((r) => where.id.in.includes(r.id) && r.tenantId === where.tenantId && where.status.in.includes(r.status));
            hit.forEach((r) => Object.assign(r, data));
            return { count: hit.length };
          }),
          findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
        },
      },
    });
    return { svc, rows, createForTenant, seatAppointment };
  }
  const desk = (tenantId: string) => ({ userId: 'u-' + tenantId, email: 'd@x', role: 'SALON_ADMIN', tenantId }) as never;

  it('"Customer is here now": ARRIVED, on the floor, no confirmation text', async () => {
    const { svc, rows, createForTenant, seatAppointment } = make();
    const r: Row = await svc.create(desk('A'), { serviceId: 's', startTime: new Date().toISOString(), customerFirstName: 'Anna', arrivedNow: true } as never);
    expect(r.status).toBe('ARRIVED');
    expect(r.arrivedAt).toBeInstanceOf(Date);
    expect(rows[0].dto.arrivedNow).toBeUndefined(); // never reaches the shared create path
    expect(createForTenant.mock.calls[0][5]).toMatchObject({ quiet: true });
    expect(seatAppointment).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A' }), r.id);
  });

  it('without the tick, or for a later time, it stays a normal booking', async () => {
    const { svc, rows, seatAppointment } = make();
    await svc.create(desk('A'), { serviceId: 's', startTime: new Date().toISOString(), customerFirstName: 'Anna' } as never);
    await svc.create(desk('A'), { serviceId: 's', startTime: new Date(Date.now() + 3 * 3600_000).toISOString(), customerFirstName: 'Bea', arrivedNow: true } as never);
    expect(rows.map((x) => x.status)).toEqual(['PENDING', 'PENDING']);
    expect(rows.map((x) => !!x.opts?.quiet)).toEqual([false, false]);
    expect(seatAppointment).not.toHaveBeenCalled();
  });

  it('cross-tenant: the ARRIVED write is fenced to the desk’s own salon', async () => {
    const { svc } = make();
    await svc.create(desk('A'), { serviceId: 's', startTime: new Date().toISOString(), customerFirstName: 'Anna', arrivedNow: true } as never);
    const upd = ((svc as unknown as Row).prisma.appointment.updateMany as jest.Mock).mock.calls[0][0];
    expect(upd.where.tenantId).toBe('A');
  });

  it('the floor being unavailable never fails the booking', async () => {
    const { svc, seatAppointment } = make();
    seatAppointment.mockRejectedValueOnce(new Error('no chair'));
    const r: Row = await svc.create(desk('A'), { serviceId: 's', startTime: new Date().toISOString(), customerFirstName: 'Anna', arrivedNow: true } as never);
    expect(r.status).toBe('ARRIVED');
  });
});
