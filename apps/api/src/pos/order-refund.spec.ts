/**
 * Money on a bill only moves forward: a paid bill is refunded or voided —
 * with a reason, by someone allowed to — and never deleted. Never another
 * salon's bill.
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
const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;
const other = { userId: 'u9', tenantId: 't2', role: 'SALON_ADMIN' } as never;

function make(opts: { orders: Row[]; payments: Row[]; intents?: Row[]; openShift?: string | null; appts?: Row[] }) {
  const { orders, payments } = opts;
  const audits: Row[] = [];
  const moves: Row[] = [];
  const wheres: Row[] = [];
  const appts = opts.appts ?? [];
  const match = (p: Row, w: Row) => p.tenantId === w.tenantId
    && (w.providerReference === undefined || (typeof w.providerReference === 'string' ? p.providerReference === w.providerReference : (w.providerReference.in as string[]).includes(p.providerReference)))
    && (w.status === undefined || p.status === w.status)
    && (w.amountCents === undefined || p.amountCents < w.amountCents.lt);
  const paymentApi = {
    findMany: async ({ where }: Row) => { wheres.push(where); return payments.filter((p) => match(p, where)); },
    create: async ({ data }: Row) => { payments.push({ ...data }); return data; },
    updateMany: async ({ where, data }: Row) => { wheres.push(where); payments.filter((p) => match(p, where)).forEach((p) => Object.assign(p, data)); return { count: 1 }; },
    deleteMany: async () => ({ count: 1 }),
  };
  const tx: Row = {
    order: {
      updateMany: async ({ where, data }: Row) => { wheres.push(where); orders.filter((o) => o.id === where.id && o.tenantId === where.tenantId).forEach((o) => Object.assign(o, data)); return { count: 1 }; },
      findMany: async () => [],
      deleteMany: async ({ where }: Row) => { const i = orders.findIndex((o) => o.id === where.id && o.tenantId === where.tenantId); if (i >= 0) orders.splice(i, 1); return { count: 1 }; },
    },
    payment: paymentApi,
    product: { updateMany: async () => ({ count: 0 }) },
    appointment: { updateMany: async ({ where, data }: Row) => { appts.filter((a) => a.tenantId === where.tenantId).forEach((a) => Object.assign(a, data)); return { count: 0 }; } },
    cashMovement: { create: async ({ data }: Row) => { moves.push(data); return data; } },
  };
  const prisma: Row = {
    order: {
      findFirst: async ({ where }: Row) => { wheres.push(where); const o = orders.find((x) => x.id === where.id && x.tenantId === where.tenantId); return o ? { items: [], tenders: [], ...o } : null; },
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { totalCents: 0 } }),
    },
    payment: paymentApi,
    paymentIntentRecord: { findFirst: async ({ where }: Row) => (opts.intents ?? []).find((i) => i.tenantId === where.tenantId && i.status === where.status && (where.OR as Row[]).some((c) => (c.orderId && c.orderId === i.orderId) || (c.clientRef && c.clientRef === i.clientRef))) ?? null },
    payrollRun: { findMany: async () => [] },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    auditLog: { findMany: async ({ where }: Row) => { wheres.push(where); return []; } },
    customer: { findFirst: async () => null, findMany: async () => [] },
    appointment: { findMany: async () => [] },
    staffMember: { findMany: async () => [] },
    user: { findMany: async () => [] },
    $transaction: async (fn: (t: Row) => Promise<unknown>) => fn(tx),
  };
  const svc = new PosService(
    prisma as never, { log: async (a: Row) => { audits.push(a); } } as never,
    { openShiftId: async () => opts.openShift ?? null } as never, {} as never,
    { reverseForRef: async () => undefined } as never, {} as never, { capture: async () => undefined } as never,
  );
  (svc as unknown as Row).recreditGiftCards = async () => undefined;
  return { svc, audits, moves, wheres, payments, orders, appts };
}

const paidBill = (over: Row = {}) => ({ id: 'o1', tenantId: 't1', status: 'PAID', orderNumber: 41, totalCents: 6900, paidCents: 6900, currency: 'USD', shiftId: 's-old', appointmentId: 'a1', appointmentIds: ['a1'], items: [{ id: 'l1', kind: 'SERVICE', quantity: 1 }, { id: 'l2', kind: 'SERVICE', quantity: 1 }], tenders: [{ method: 'CARD', amountCents: 6900 }], ...over });
const mirror = (over: Row = {}) => ({ tenantId: 't1', providerReference: 'order:o1', status: 'PAID', amountCents: 6900, ...over });

describe('refunding a paid bill', () => {
  it('part of it: one negative row today, the bill stands, the reason is kept', async () => {
    const { svc, payments, orders, audits } = make({ orders: [paidBill()], payments: [mirror()] });
    await svc.refundOrder(admin, 'o1', { amountCents: 1500, method: 'CARD', reason: 'Khách không hài lòng', note: 'vẽ bị lem', itemIds: ['l2', 'nope'] });
    const back = payments.filter((p) => p.amountCents < 0);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ tenantId: 't1', amountCents: -1500, providerReference: 'order:o1', status: 'PAID', provider: 'pos-card' });
    expect(orders[0].status).toBe('PAID');
    const a = audits.find((x) => x.action === 'order.refunded');
    expect(a).toMatchObject({ tenantId: 't1', userId: 'u1', resourceId: 'o1' });
    expect(a!.metadata).toMatchObject({ amountCents: 1500, reason: 'Khách không hài lòng', itemIds: ['l2'], full: false });
  });

  it('cash handed back is written into the open shift as cash out', async () => {
    const { svc, moves } = make({ orders: [paidBill({ tenders: [{ method: 'CASH', amountCents: 6900 }] })], payments: [mirror()], openShift: 's-now' });
    await svc.refundOrder(admin, 'o1', { amountCents: 2000, method: 'CASH', reason: 'Thu nhầm' });
    expect(moves).toEqual([expect.objectContaining({ tenantId: 't1', shiftId: 's-now', kind: 'OUT', amountCents: 2000 })]);
  });

  it('all of it: off the books like a void, but the visit happened — the booking is not reopened', async () => {
    const appts = [{ id: 'a1', tenantId: 't1', status: 'COMPLETED' }];
    const { svc, orders, payments } = make({ orders: [paidBill()], payments: [mirror()], appts });
    await svc.refundOrder(admin, 'o1', { amountCents: 6900, method: 'CASH', reason: 'Khác' });
    expect(orders[0].status).toBe('REFUNDED');
    expect(payments.every((p) => p.status === 'REFUNDED')).toBe(true);
    expect(payments.some((p) => p.amountCents < 0)).toBe(false);
    expect(appts[0].status).toBe('COMPLETED');
  });

  it('needs a reason, a real method and an amount it can cover', async () => {
    const { svc } = make({ orders: [paidBill()], payments: [mirror(), mirror({ amountCents: -900 })] });
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 500, method: 'CASH' })).rejects.toThrow(/lý do/);
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 500, method: 'BITCOIN', reason: 'x' })).rejects.toThrow(/cách hoàn/);
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 0, method: 'CASH', reason: 'x' })).rejects.toThrow(/lớn hơn 0/);
    // 6900 in, 900 already back → at most 6000.
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 6001, method: 'CASH', reason: 'x' })).rejects.toThrow(/Tối đa/);
  });

  it('a charge made on the connected card terminal goes back through the terminal, never twice', async () => {
    const { svc } = make({ orders: [paidBill()], payments: [mirror()], intents: [{ tenantId: 't1', orderId: 'o1', status: 'SUCCEEDED' }] });
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 1000, method: 'CARD', reason: 'x' })).rejects.toThrow(/Máy quẹt thẻ/);
  });

  it('only a paid bill', async () => {
    const { svc } = make({ orders: [paidBill({ status: 'VOID' })], payments: [] });
    await expect(svc.refundOrder(admin, 'o1', { amountCents: 100, method: 'CASH', reason: 'x' })).rejects.toThrow(/đã thu tiền/);
  });

  it("never another salon's bill — and touches nothing of it", async () => {
    const { svc, payments, orders, wheres } = make({ orders: [paidBill()], payments: [mirror()] });
    await expect(svc.refundOrder(other, 'o1', { amountCents: 100, method: 'CASH', reason: 'x' })).rejects.toThrow(/not found/i);
    expect(payments).toHaveLength(1);
    expect(orders[0].status).toBe('PAID');
    for (const w of wheres) expect(w.tenantId).toBe('t2');
  });
});

describe('voiding and deleting', () => {
  it('a bill that already gave money back is not voided (refund the rest instead)', async () => {
    const { svc, orders } = make({ orders: [paidBill()], payments: [mirror(), mirror({ amountCents: -1500 })] });
    await expect(svc.voidOrder(admin, 'o1', { reason: 'Trùng bill' })).rejects.toThrow(/hoàn tiếp/);
    expect(orders[0].status).toBe('PAID');
  });

  it('a void keeps its reason', async () => {
    const { svc, audits } = make({ orders: [paidBill()], payments: [mirror()] });
    (svc as unknown as Row).getOrder = async () => ({});
    await svc.voidOrder(admin, 'o1', { reason: 'Trùng bill', note: 'bấm 2 lần' });
    expect(audits.find((a) => a.action === 'order.voided')!.metadata).toMatchObject({ reason: 'Trùng bill', note: 'bấm 2 lần' });
  });

  it('a paid, voided or refunded bill is never deleted', async () => {
    for (const status of ['PAID', 'VOID', 'REFUNDED']) {
      const { svc, orders } = make({ orders: [paidBill({ status })], payments: [mirror()] });
      await expect(svc.removeOrder(admin, 'o1')).rejects.toThrow(/không xoá được/);
      expect(orders).toHaveLength(1);
    }
  });

  it('a draft nobody paid on may be deleted', async () => {
    const { svc, orders } = make({ orders: [paidBill({ status: 'OPEN', paidCents: 0, tenders: [] })], payments: [] });
    await svc.removeOrder(admin, 'o1');
    expect(orders).toHaveLength(0);
  });
});

describe("the bill's page", () => {
  it('adds up money in and back, and says what may be done next', async () => {
    const { svc } = make({ orders: [paidBill()], payments: [mirror(), mirror({ amountCents: -1500, paidAt: new Date() })] });
    const d = await svc.orderDetail(admin, 'o1') as Row;
    expect(d.collectedCents).toBe(5400);
    expect(d.refundedCents).toBe(1500);
    expect(d.refunds).toHaveLength(1);
    expect(d.canRefund).toBe(true);
    expect(d.canVoid).toBe(false);
    expect(d.canDelete).toBe(false);
  });

  it("another salon's bill is not found, and every read names the caller's salon", async () => {
    const { svc, wheres } = make({ orders: [paidBill()], payments: [mirror()] });
    await expect(svc.orderDetail(other, 'o1')).rejects.toThrow(/not found/i);
    for (const w of wheres) expect(w.tenantId).toBe('t2');
  });
});
