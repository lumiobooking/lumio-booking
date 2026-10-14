/**
 * The till's sale has to reach every screen that reads it.
 *
 * - A paid ticket carries paidAt: payroll, the sales report and performance
 *   all read sales by paidAt, and a ticket without one counted for nobody.
 * - A checked-in booking paid through its floor ticket is named on the order
 *   (payroll never counts the visit twice) and moves from ARRIVED to COMPLETED.
 * - Another salon's ticket or booking is never read or changed.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    OrderStatus: actual.OrderStatus ?? { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID' },
    OrderItemKind: actual.OrderItemKind ?? { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
    PaymentMethod: actual.PaymentMethod ?? { CASH: 'CASH', CARD: 'CARD' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID' },
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW' },
    PaymentType: actual.PaymentType?.PAY_ONLINE ? actual.PaymentType : { PAY_LATER: 'PAY_LATER', PAY_ONLINE: 'PAY_ONLINE' },
  };
});
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const T1 = 't1';
const admin = { userId: 'u1', tenantId: T1, role: 'SALON_ADMIN' } as never;

function make(o: { tickets?: Row[]; appts?: Row[]; payments?: Row[] } = {}) {
  const tickets = o.tickets ?? [];
  const appts = o.appts ?? [];
  const payments = o.payments ?? [];
  const reversed: string[] = [];
  let orderData: Row = {};
  const apptUpdates: Row[] = [];
  const reads: Row[] = [];
  const tx: Row = {
    order: {
      findFirst: jest.fn(async ({ where }: Row) => (where.id ? { id: 'o1', orderNumber: 42, ...orderData } : { orderNumber: 41 })),
      create: async ({ data }: Row) => { orderData = data; return { id: 'o1', currency: 'USD', ...data }; },
    },
    orderItem: { createMany: async () => undefined },
    orderPayment: { createMany: async () => undefined },
    payment: {
      create: async () => undefined,
      findMany: async ({ where }: Row) => payments.filter((p) => p.tenantId === where.tenantId && where.appointmentId.in.includes(p.appointmentId) && p.status === 'PAID' && p.type === 'PAY_LATER' && p.providerReference == null),
      updateMany: async ({ where, data }: Row) => { const hit = payments.filter((p) => p.id === where.id && p.tenantId === where.tenantId); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length }; },
    },
    product: { updateMany: async () => undefined },
    appointment: {
      findFirst: async ({ where }: Row) => appts.find((a) => a.id === where.id && a.tenantId === where.tenantId) ?? null,
      updateMany: async (a: Row) => { apptUpdates.push(a); return { count: 1 }; },
    },
    walkIn: { updateMany: async () => ({ count: 1 }) },
    service: { findMany: async () => [] },
  };
  const prisma: Row = {
    order: { findFirst: async () => null },
    walkIn: { findMany: async ({ where }: Row) => { reads.push(where); return tickets.filter((t) => t.tenantId === where.tenantId && where.id.in.includes(t.id) && t.appointmentId); } },
    payment: { findMany: async ({ where }: Row) => { reads.push(where); return payments.filter((p) => p.tenantId === where.tenantId && where.appointmentId.in.includes(p.appointmentId) && p.status === 'PAID' && p.type === 'PAY_ONLINE'); } },
    appointment: {
      findFirst: async () => null,
      findMany: async ({ where }: Row) => { reads.push(where); return appts.filter((a) => a.tenantId === where.tenantId && where.id.in.includes(a.id) && a.status === where.status); },
    },
    $transaction: async (fn: (t: Row) => Promise<unknown>) => fn(tx),
  };
  const svc = new PosService(
    prisma as never,
    { log: async () => undefined } as never,
    { openShiftId: async () => null } as never,
    { getPosSettings: async () => ({ taxRatePercent: 0 }), getBookingRules: async () => ({ currency: 'USD' }) } as never,
    { reverseForRef: async (_tx: unknown, _t: string, _k: string, id: string) => { reversed.push(id); }, award: async () => undefined } as never,
    {} as never, {} as never,
    { seatWaitingQueue: async () => [] } as never,
  );
  return { svc, order: () => orderData, apptUpdates, reads, payments, reversed };
}

const sale = (o: Row = {}) => ({
  items: [{ kind: 'SERVICE', serviceId: 'gel', name: 'Gel Manicure', unitPriceCents: 4500, staffMemberId: 'cindy' }],
  tenders: [{ method: 'CASH', amountCents: 4500 }],
  ...o,
}) as never;

describe('a paid ticket reaches payroll and the reports', () => {
  it('a paid sale carries paidAt; an unpaid (open) ticket does not', async () => {
    const paid = make();
    await paid.svc.createOrder(admin, sale());
    expect(paid.order().status).toBe('PAID');
    expect(paid.order().paidAt).toBeInstanceOf(Date);
    const open = make();
    await open.svc.createOrder(admin, sale({ tenders: [] }));
    expect(open.order().status).toBe('OPEN');
    expect(open.order().paidAt).toBeNull();
  });
});

describe('a checked-in booking paid through its floor ticket', () => {
  it('is named on the order and moves from ARRIVED to COMPLETED', async () => {
    const f = make({
      tickets: [{ id: 'w1', tenantId: T1, appointmentId: 'a1' }],
      appts: [{ id: 'a1', tenantId: T1, status: 'ARRIVED', serviceId: 'gel', startTime: new Date('2026-10-12T15:00:00Z'), endTime: new Date('2026-10-12T15:45:00Z') }],
    });
    await f.svc.createOrder(admin, sale({ walkInId: 'w1' }));
    expect(f.order().appointmentId).toBe('a1');
    expect(f.order().appointmentIds).toEqual(['a1']);
    expect(f.apptUpdates).toHaveLength(1);
    expect(f.apptUpdates[0].where).toEqual({ id: 'a1', tenantId: T1 });
    expect(f.apptUpdates[0].data.status).toBe('COMPLETED');
  });

  it('a booking already completed is linked (no double count) but not completed again', async () => {
    const f = make({
      tickets: [{ id: 'w1', tenantId: T1, appointmentId: 'a1' }],
      appts: [{ id: 'a1', tenantId: T1, status: 'COMPLETED' }],
    });
    await f.svc.createOrder(admin, sale({ walkInId: 'w1' }));
    expect(f.order().appointmentIds).toEqual(['a1']);
    expect(f.apptUpdates).toHaveLength(0);
  });

  it("never reads or completes another salon's ticket or booking", async () => {
    const f = make({
      tickets: [{ id: 'w9', tenantId: 't2', appointmentId: 'b9' }],
      appts: [{ id: 'b9', tenantId: 't2', status: 'ARRIVED' }],
    });
    await f.svc.createOrder(admin, sale({ walkInId: 'w9' }));
    for (const w of f.reads) expect(w.tenantId).toBe(T1);
    expect(f.order().appointmentIds).toEqual([]);
    expect(f.apptUpdates).toHaveLength(0);
  });

  it('a plain walk-in (no booking) stays a walk-in sale', async () => {
    const f = make({ tickets: [{ id: 'w2', tenantId: T1, appointmentId: null }] });
    await f.svc.createOrder(admin, sale({ walkInId: 'w2' }));
    expect(f.order().appointmentId).toBeNull();
    expect(f.apptUpdates).toHaveLength(0);
  });
});

describe('money already paid for the booking', () => {
  const booked = { id: 'a1', tenantId: T1, status: 'CONFIRMED', serviceId: 'gel', startTime: new Date('2026-10-12T15:00:00Z'), endTime: new Date('2026-10-12T15:45:00Z') };
  it('an online deposit is credited: the till takes only the rest, and the ticket is paid', async () => {
    const f = make({ appts: [booked], payments: [{ id: 'd1', tenantId: T1, appointmentId: 'a1', amountCents: 1500, status: 'PAID', type: 'PAY_ONLINE' }] });
    await f.svc.createOrder(admin, sale({ appointmentId: 'a1', tenders: [{ method: 'CASH', amountCents: 3000 }] }));
    expect(f.order().status).toBe('PAID');
    expect(f.order().paidCents).toBe(4500);
    expect(f.order().changeCents).toBe(0);
  });
  it("another salon's deposit is never credited", async () => {
    const f = make({ appts: [booked], payments: [{ id: 'd9', tenantId: 't2', appointmentId: 'a1', amountCents: 1500, status: 'PAID', type: 'PAY_ONLINE' }] });
    await expect(f.svc.createOrder(admin, sale({ appointmentId: 'a1', tenders: [{ method: 'CASH', amountCents: 3000 }] }))).rejects.toThrow(/less than the amount due/);
  });
  it('a balance row written by "Complete" before checkout gives way to the till (no double revenue, no double points)', async () => {
    const f = make({ appts: [booked], payments: [{ id: 'bal', tenantId: T1, appointmentId: 'a1', amountCents: 4500, status: 'PAID', type: 'PAY_LATER', providerReference: null }] });
    await f.svc.createOrder(admin, sale({ appointmentId: 'a1' }));
    expect(f.payments[0].status).toBe('REFUNDED');
    expect(f.payments[0].providerReference).toBe('superseded:order:o1');
    expect(f.reversed).toEqual(['bal']);
  });
});

describe('the ticket records what really happened', () => {
  it('a card sale over the due (surcharge) is not "change"; cash over the due is', async () => {
    const card = make();
    await card.svc.createOrder(admin, sale({ tenders: [{ method: 'CARD', amountCents: 4635 }] }));
    expect(card.order().changeCents).toBe(0);
    const cash = make();
    await cash.svc.createOrder(admin, sale({ tenders: [{ method: 'CASH', amountCents: 5000 }] }));
    expect(cash.order().changeCents).toBe(500);
  });
  it('an offline sale keeps the time it was sold (within a week, never the future)', async () => {
    const at = new Date(Date.now() - 20 * 3600000);
    const f = make();
    await f.svc.createOrder(admin, sale({ offline: true, soldAt: at.toISOString() }));
    expect((f.order().paidAt as Date).getTime()).toBe(at.getTime());
    expect((f.order().createdAt as Date).getTime()).toBe(at.getTime());
    const old = make();
    await old.svc.createOrder(admin, sale({ offline: true, soldAt: new Date(Date.now() - 30 * 86400000).toISOString() }));
    expect(old.order().createdAt).toBeUndefined();
    const online = make();
    await online.svc.createOrder(admin, sale({ soldAt: at.toISOString() }));
    expect(online.order().createdAt).toBeUndefined();
  });
});
