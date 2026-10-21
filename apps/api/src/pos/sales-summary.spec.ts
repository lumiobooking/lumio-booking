/**
 * The sales summary adds up like a till's Z-report — and only ever reads the
 * caller's own salon.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    OrderStatus: actual.OrderStatus?.REFUNDED ? actual.OrderStatus : { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID', REFUNDED: 'REFUNDED' },
    OrderItemKind: actual.OrderItemKind ?? { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID', REFUNDED: 'REFUNDED', FAILED: 'FAILED' },
    PaymentType: actual.PaymentType ?? { PAY_ONLINE: 'PAY_ONLINE', PAY_LATER: 'PAY_LATER' },
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE' },
  };
});
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(orders: Row[], payments: Row[]) {
  const wheres: Row[] = [];
  const inRange = (d: Date, w: Row) => d >= w.paidAt.gte && d <= w.paidAt.lte;
  const prisma: Row = {
    order: { findMany: async ({ where }: Row) => { wheres.push(where); return orders.filter((o) => o.tenantId === where.tenantId && (where.status.in as string[]).includes(o.status) && inRange(o.paidAt, where)); } },
    payment: { findMany: async ({ where }: Row) => { wheres.push(where); return payments.filter((p) => p.tenantId === where.tenantId && p.status === where.status && inRange(p.paidAt, where)); } },
    tenant: { findUnique: async () => ({ timezone: 'America/New_York' }) },
  };
  const svc = new PosService(prisma as never, { log: async () => undefined } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, wheres };
}
const at = (s: string) => new Date(s);
const line = (unit: number, disc = 0, kind = 'SERVICE', qty = 1) => ({ kind, unitPriceCents: unit, quantity: qty, discountCents: disc, lineTotalCents: unit * qty - disc });

describe('sales summary', () => {
  const orders = [
    // Oct 20, evening in Georgia (00:30 UTC on the 21st) — still the 20th.
    { tenantId: 't1', status: 'PAID', paidAt: at('2026-10-21T00:30:00Z'), discountCents: 500, taxCents: 0, tipCents: 900, currency: 'USD', items: [line(4500), line(1500, 0)] },
    { tenantId: 't1', status: 'PAID', paidAt: at('2026-10-21T15:00:00Z'), discountCents: 0, taxCents: 80, tipCents: 0, currency: 'USD', items: [line(1000, 0, 'PRODUCT')] },
    // Refunded in full: in gross and in refunds, its tip and tax nowhere.
    { tenantId: 't1', status: 'REFUNDED', paidAt: at('2026-10-21T16:00:00Z'), discountCents: 0, taxCents: 0, tipCents: 700, currency: 'USD', items: [line(3000)] },
    // Another salon's sale.
    { tenantId: 't2', status: 'PAID', paidAt: at('2026-10-21T16:00:00Z'), discountCents: 0, taxCents: 0, tipCents: 0, currency: 'USD', items: [line(99900)] },
  ];
  const payments = [
    { tenantId: 't1', status: 'PAID', paidAt: at('2026-10-21T00:31:00Z'), amountCents: 6400, provider: 'pos-card' },
    { tenantId: 't1', status: 'PAID', paidAt: at('2026-10-21T15:01:00Z'), amountCents: 1080, provider: 'pos-cash' },
    // A part refund on the 21st.
    { tenantId: 't1', status: 'PAID', paidAt: at('2026-10-21T18:00:00Z'), amountCents: -1500, provider: 'pos-card' },
    { tenantId: 't2', status: 'PAID', paidAt: at('2026-10-21T18:00:00Z'), amountCents: 99900, provider: 'pos-card' },
  ];
  const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;

  it('gross − discounts − refunds = net; + tax + tips = total; by the salon day', async () => {
    const { svc } = make(orders, payments);
    const r = await svc.salesSummary(admin, '2026-10-20', '2026-10-21') as Row;
    expect(r.totals).toMatchObject({
      bills: 2, refundedBills: 1,
      grossCents: 4500 + 1500 + 1000 + 3000, discountCents: 500, refundCents: 3000 + 1500,
      netCents: 10000 - 500 - 4500, taxCents: 80, tipsCents: 900,
    });
    expect(r.totals.totalCents).toBe(r.totals.netCents + 80 + 900);
    expect(r.byMethod).toEqual({ cash: 1080, card: 6400 - 1500, transfer: 0, online: 0 });
    expect(r.days.map((d: Row) => d.day)).toEqual(['2026-10-20', '2026-10-21']);
    expect(r.days[0]).toMatchObject({ bills: 1, grossCents: 6000, discountCents: 500, netCents: 5500, tipsCents: 900 });
    expect(r.totals.serviceCents).toBe(6000);
    expect(r.totals.productCents).toBe(1000);
  });

  it("reads only the caller's salon — the period and the one before", async () => {
    const { svc, wheres } = make(orders, payments);
    await svc.salesSummary({ userId: 'u2', tenantId: 't2', role: 'SALON_ADMIN' } as never, '2026-10-20', '2026-10-21');
    expect(wheres.length).toBe(4);
    for (const w of wheres) expect(w.tenantId).toBe('t2');
  });

  it('refuses a backwards range', async () => {
    const { svc } = make(orders, payments);
    await expect(svc.salesSummary(admin, '2026-10-21', '2026-10-01')).rejects.toThrow(/không hợp lệ/);
  });
});
