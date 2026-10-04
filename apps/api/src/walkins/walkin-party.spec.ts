/**
 * A party on the floor: friends who came in together wear one letter, each
 * with her own ticket, services and technician; a booked party is checked in
 * with one press; and one salon's party never includes another's bookings.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    AppointmentStatus: actual.AppointmentStatus ?? { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { WalkinsService } from './walkins.service';
import { partyTags } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('gte' in cond) return v != null && v >= cond.gte && (!('lt' in cond) || v < cond.lt);
      if ('not' in cond) return v !== cond.not;
      return true;
    }
    return v === cond;
  });
}
function table(rows: Row[]) {
  return {
    rows,
    findMany: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
    groupBy: async () => [],
    create: async ({ data }: Row) => { const r = { id: `w${rows.length + 1}`, createdAt: new Date(), items: [], ...data }; rows.push(r); return r; },
    update: async ({ where, data }: Row) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
    updateMany: async ({ where, data }: Row) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
  };
}
const T1 = 't1';
const tech = (id: string) => ({ id, tenantId: T1, firstName: id, lastName: null, avatarUrl: null, bookingPriority: 0, isActive: true, takesAppointments: true });
const MENU = [
  { id: 'mani', tenantId: T1, name: 'Gel Manicure', priceCents: 3500, discountPercent: 0, durationMinutes: 40, turnValue: 1, category: null },
  { id: 'pedi', tenantId: T1, name: 'Spa Pedicure', priceCents: 4500, discountPercent: 0, durationMinutes: 50, turnValue: 1, category: null },
];
const admin = { userId: 'u-admin', tenantId: T1, role: 'SALON_ADMIN' } as never;

function floor(o: { appts?: Row[]; staff?: Row[] } = {}) {
  const prisma = {
    tenant: table([{ id: T1, timezone: 'America/Chicago' }]),
    staffMember: table(o.staff ?? [tech('hana'), tech('lisa'), tech('mia')]),
    staffService: table([]),
    walkIn: table([]),
    service: table(MENU),
    station: table([]),
    appointment: table(o.appts ?? []),
    order: table([]),
    tipLog: table([]),
  };
  const svc = new WalkinsService(prisma as never, {} as never, { getBookingRules: async () => ({ currency: 'USD' }) } as never);
  return { prisma, svc };
}

describe('a party walks in', () => {
  it('one ticket per person, one groupId, each with her own services and technician', async () => {
    const f = floor();
    const lead: Row = await f.svc.add(admin, { customerName: 'Anna', serviceIds: ['mani'], guests: [{ firstName: 'Linh', serviceIds: ['pedi'] }, { serviceIds: ['mani', 'pedi'] }], autoAssign: true });
    expect(lead.guestIds).toHaveLength(2);
    const rows = f.prisma.walkIn.rows;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows[0].groupId).toMatch(/^wk-/);
    expect(rows.map((r) => r.customerName)).toEqual(['Anna', 'Linh', 'Guest 3']);
    expect(rows.map((r) => r.partySize)).toEqual([3, 3, 3]);
    expect(rows[1].note).toBe('With Anna');
    expect(rows[1].customerId).toBeNull();
    expect(rows.map((r) => r.items.length)).toEqual([1, 1, 2]);
    // Three technicians, three people: everyone starts.
    expect(rows.map((r) => r.status)).toEqual(['SERVING', 'SERVING', 'SERVING']);
  });

  it('a lone walk-in has no group at all', async () => {
    const f = floor();
    const w: Row = await f.svc.add(admin, { customerName: 'Mai', serviceIds: ['mani'] });
    expect(w.guestIds).toBeUndefined();
    expect(f.prisma.walkIn.rows[0].groupId).toBeNull();
  });
});

describe('a booked party is checked in with one press', () => {
  const appt = (id: string, extra: Row = {}): Row => ({ id, tenantId: T1, status: 'CONFIRMED', groupId: 'ph-1', customerId: null, source: 'hotline', assignedStaffId: null, addons: [], startTime: new Date(), customer: { firstName: id, lastName: null, phone: null }, service: { id: 'mani', name: 'Gel Manicure' }, createdAt: new Date(), ...extra });

  it('seats every open member of the group, reuses one already on the floor, skips the one who cancelled', async () => {
    const f = floor({ appts: [appt('a1'), appt('a2'), appt('a3', { status: 'CANCELLED' }), appt('a4', { groupId: 'other' })] });
    await f.svc.seatAppointment(admin, 'a2'); // a2 arrived earlier on her own
    const out: Row = await f.svc.seatParty(admin, 'a1');
    expect(out.partyTickets).toHaveLength(2);
    const rows = f.prisma.walkIn.rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.appointmentId).sort()).toEqual(['a1', 'a2']);
    expect(rows.every((r) => r.groupId === 'ph-1')).toBe(true);
    expect(f.prisma.appointment.rows.find((a) => a.id === 'a3')!.status).toBe('CANCELLED');
    expect(f.prisma.appointment.rows.find((a) => a.id === 'a4')!.status).toBe('CONFIRMED');
  });

  it("never seats another salon's booking that happens to share the groupId", async () => {
    const f = floor({ appts: [appt('a1'), appt('x1', { tenantId: 't2' })] });
    const out: Row = await f.svc.seatParty(admin, 'a1');
    expect(out.partyTickets).toEqual([out.id]);
    expect(f.prisma.walkIn.rows.every((r) => r.tenantId === T1)).toBe(true);
    expect(f.prisma.appointment.rows.find((a) => a.id === 'x1')!.status).toBe('CONFIRMED');
    await expect(f.svc.seatParty(admin, 'x1')).rejects.toThrow('Appointment not found');
  });
});

describe('letters on the board', () => {
  it('parties get A, B… by first arrival, with where their members are', () => {
    const t = (id: string, groupId: string | null, status: string, min: number, awaitingPayment = false) =>
      ({ id, groupId, status, awaitingPayment, assignedStaffId: null, createdAt: new Date(2030, 0, 1, 10, min), items: [] });
    const tags = partyTags([
      t('b1', 'g-b', 'WAITING', 20), t('a1', 'g-a', 'SERVING', 5), t('a2', 'g-a', 'DONE', 5), t('a3', 'g-a', 'WAITING', 6),
      t('solo', null, 'SERVING', 1), t('b2', 'g-b', 'CANCELLED', 20),
    ]);
    expect(tags.get('g-a')).toEqual({ tag: 'A', size: 3, waiting: 1, serving: 1, done: 1 });
    expect(tags.get('g-b')).toEqual({ tag: 'B', size: 1, waiting: 1, serving: 0, done: 0 });
    expect(tags.size).toBe(2);
  });
});
