/**
 * A party at the till: one sale can settle several floor tickets, every line
 * remembers whose it was, and the party view reads back which lines are paid
 * — in this salon only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    OrderStatus: actual.OrderStatus ?? { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID' },
    OrderItemKind: actual.OrderItemKind ?? { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
    PaymentMethod: actual.PaymentMethod ?? { CASH: 'CASH', CARD: 'CARD' },
    PaymentType: actual.PaymentType ?? { PAY_LATER: 'PAY_LATER', DEPOSIT: 'DEPOSIT' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID' },
  };
});
// pos.service pulls in the feedback dispatcher, whose uploads client needs a
// package the test runner does not have; neither is exercised here.
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';
import { WalkinsService } from '../walkins/walkins.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const T1 = 't1';
const admin = { userId: 'u1', tenantId: T1, role: 'SALON_ADMIN' } as never;

describe('one sale settles the whole party', () => {
  it('marks every ticket of the party Done and keeps whose line was whose', async () => {
    const walkInUpdates: Row[] = [];
    const itemRows: Row[] = [];
    let orderData: Row = {};
    const tx: Row = {
      order: {
        findFirst: async () => ({ orderNumber: 41 }),
        create: async ({ data }: Row) => { orderData = data; return { id: 'o1', currency: 'USD', ...data }; },
      },
      orderItem: { createMany: async ({ data }: Row) => { itemRows.push(...data); } },
      orderPayment: { createMany: async () => undefined },
      payment: { create: async () => undefined },
      product: { updateMany: async () => undefined },
      appointment: { findFirst: async () => null, updateMany: async () => undefined },
      walkIn: { updateMany: async (a: Row) => { walkInUpdates.push(a); return { count: 2 }; } },
    };
    tx.order.findFirst = jest.fn(async ({ where }: Row) => (where.id ? { id: 'o1', orderNumber: 42, ...orderData } : { orderNumber: 41 }));
    const prisma: Row = { order: { findFirst: async () => null }, $transaction: async (fn: (t: Row) => Promise<unknown>) => fn(tx) };
    const seat = jest.fn(async () => []);
    const svc = new PosService(
      prisma as never,
      { log: async () => undefined } as never,
      { openShiftId: async () => null } as never,
      { getPosSettings: async () => ({ taxRatePercent: 0 }), getBookingRules: async () => ({ currency: 'USD' }) } as never,
      {} as never, {} as never, {} as never,
      { seatWaitingQueue: seat } as never,
    );
    await svc.createOrder(admin, {
      walkInId: 'anna', walkInIds: ['anna', 'linh'],
      items: [
        { kind: 'SERVICE', serviceId: 'gel', name: 'Anna · Gel Manicure', unitPriceCents: 4500, staffMemberId: 'cindy', walkInId: 'anna', walkInLineId: 'l1', guestName: 'Anna' },
        { kind: 'SERVICE', serviceId: 'pedi', name: 'Linh · Spa Pedicure', unitPriceCents: 5500, staffMemberId: 'ivy', walkInId: 'linh', walkInLineId: 'l2', guestName: 'Linh' },
      ],
      tenders: [{ method: 'CARD', amountCents: 10000 }],
    } as never);
    expect(orderData.walkInId).toBe('anna');
    expect(orderData.walkInIds).toEqual(['anna', 'linh']);
    expect(walkInUpdates).toHaveLength(1);
    expect(walkInUpdates[0].where).toEqual({ id: { in: ['anna', 'linh'] }, tenantId: T1 });
    expect(walkInUpdates[0].data.status).toBe('DONE');
    expect(itemRows.map((r) => [r.walkInId, r.walkInLineId, r.guestName])).toEqual([['anna', 'l1', 'Anna'], ['linh', 'l2', 'Linh']]);
    expect(seat).toHaveBeenCalledWith(T1); // the chairs just freed go to whoever waited longest
  });
});

describe("the till's view of a party", () => {
  const ticket = (id: string, o: Row = {}): Row => ({
    id, tenantId: T1, groupId: 'wk-1', status: 'SERVING', awaitingPayment: false, customerName: id, customerId: null, phone: null, assignedStaffId: 'cindy',
    createdAt: new Date('2026-10-04T15:00:00Z'), assignedAt: new Date('2026-10-04T15:00:00Z'), doneAt: null, source: 'walkin', appointmentId: null,
    items: [{ lineId: `${id}-1`, legId: `${id}-leg`, serviceId: 'gel', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, zone: 'HAND', legStatus: 'DONE', staffId: 'cindy', startedAt: '2026-10-04T15:00:00Z', doneAt: '2026-10-04T15:45:00Z' }],
    service: null, assignedStaff: null, stationRef: null, ...o,
  });
  function make(tickets: Row[], orders: Row[], group?: Row) {
    const wheres: Row[] = [];
    const prisma: Row = {
      walkIn: { findMany: async ({ where }: Row) => { wheres.push(where); return tickets.filter((t) => t.tenantId === where.tenantId && (!where.groupId || t.groupId === where.groupId) && (!where.status?.in || where.status.in.includes(t.status)) && (!where.status?.not || t.status !== where.status.not)); } },
      order: { findMany: async ({ where }: Row) => { wheres.push(where); return orders.filter((o) => o.tenantId === where.tenantId); } },
      staffMember: { findMany: async ({ where }: Row) => (where.tenantId === T1 ? [{ id: 'cindy', firstName: 'Cindy', lastName: null, avatarUrl: null, bookingPriority: 0 }] : []) },
      staffService: { findMany: async () => [] },
      appointment: { findMany: async () => [], groupBy: async () => [] },
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    };
    const settings: Row = { getBookingRules: async () => ({}), getGroupDiscount: async () => group ?? { enabled: false, tiers: [] } };
    const svc = new WalkinsService(prisma as never, {} as never, settings as never);
    return { svc, wheres };
  }

  it('reads back which lines a friend already paid, and who is the contact', async () => {
    const anna = ticket('anna', { customerId: 'c1', phone: '512', items: [
      { lineId: 'a1', legId: 'al', serviceId: 'gel', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, zone: 'HAND', legStatus: 'DONE', staffId: 'cindy', startedAt: '2026-10-04T15:00:00Z', doneAt: '2026-10-04T15:45:00Z' },
      { lineId: 'a2', legId: 'al', serviceId: 'art', name: 'Nail Art', priceCents: 1000, durationMinutes: 10, zone: 'HAND', legStatus: 'DONE', staffId: 'cindy', startedAt: '2026-10-04T15:00:00Z', doneAt: '2026-10-04T15:45:00Z' },
    ] });
    const mai = ticket('mai', { items: [{ lineId: 'm1', legId: 'ml', serviceId: 'bld', name: 'Builder', priceCents: 7500, durationMinutes: 60, zone: 'HAND', legStatus: 'SERVING', staffId: 'cindy', startedAt: new Date(Date.now() - 20 * 60000).toISOString() }] });
    const linh = ticket('linh', { status: 'DONE', doneAt: new Date() });
    const theirs = ticket('zoe', { tenantId: 't2' });
    const orders = [
      // Linh paid for herself (whole ticket) and for one of Anna's lines.
      { id: 'o1', tenantId: T1, orderNumber: 7, status: 'PAID', walkInId: 'linh', walkInIds: ['linh'], items: [{ walkInId: 'linh', walkInLineId: 'linh-1' }, { walkInId: 'anna', walkInLineId: 'a2' }] },
      { id: 'o9', tenantId: 't2', orderNumber: 99, status: 'PAID', walkInId: 'zoe', walkInIds: ['zoe'], items: [{ walkInId: 'anna', walkInLineId: 'a1' }] },
    ];
    const { svc, wheres } = make([anna, mai, linh, theirs], orders);
    const out = await svc.party(admin, 'wk-1');
    expect(out.leaderId).toBe('anna');
    expect(out.phone).toBe('512');
    expect(out.members.map((m) => m.id)).toEqual(['anna', 'mai', 'linh']);
    const [a, m, l] = out.members;
    expect(a.items.map((i) => [i.lineId, i.paid, i.orderNumber])).toEqual([['a1', false, null], ['a2', true, 7]]);
    expect(a.paid).toBe(false);
    expect(a.finished).toBe(true);
    expect(m.finished).toBe(false);
    expect(m.minutesLeft).toBeGreaterThan(30);
    expect(l.paid).toBe(true);
    expect(l.orderNumbers).toEqual([7]);
    for (const w of wheres) expect(w.tenantId).toBe(T1);
  });

  it("offers the owner's group tier for the party's size, only while the programme runs", async () => {
    const three = [ticket('a'), ticket('b'), ticket('c')];
    const tiers = [{ minSize: 2, percent: 5 }, { minSize: 3, percent: 10 }, { minSize: 5, percent: 15 }];
    expect((await make(three, [], { enabled: true, message: 'Đi nhóm vui hơn', tiers }).svc.party(admin, 'wk-1')).groupPromo).toEqual({ percent: 10, minSize: 3, message: 'Đi nhóm vui hơn' });
    expect((await make(three.slice(0, 2), [], { enabled: true, tiers }).svc.party(admin, 'wk-1')).groupPromo).toMatchObject({ percent: 5 });
    expect((await make(three, [], { enabled: false, tiers }).svc.party(admin, 'wk-1')).groupPromo).toBeNull();
    expect((await make(three, [], { enabled: true, tiers, startDate: '2099-01-01' }).svc.party(admin, 'wk-1')).groupPromo).toBeNull();
    expect((await make(three, [], { enabled: true, tiers, endDate: '2000-01-01' }).svc.party(admin, 'wk-1')).groupPromo).toBeNull();
  });

  it("another salon's party id is nobody's party here", async () => {
    const { svc } = make([ticket('zoe', { tenantId: 't2' })], []);
    await expect(svc.party(admin, 'wk-1')).rejects.toThrow('Party not found');
  });
});
