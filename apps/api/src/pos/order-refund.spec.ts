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
// bcrypt's native binary is per-OS; the rule under test is the service's.
jest.mock('../auth/password.util', () => ({ hashSecret: async (p: string) => `h:${p}`, verifySecret: async (p: string, h: string) => h === `h:${p}` }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;
const other = { userId: 'u9', tenantId: 't2', role: 'SALON_ADMIN' } as never;

function make(opts: { orders: Row[]; payments: Row[]; intents?: Row[]; openShift?: string | null; appts?: Row[]; refunds?: Row[]; users?: Row[]; cards?: Row[]; shifts?: Row[] }) {
  const { orders, payments } = opts;
  const audits: Row[] = [];
  const moves: Row[] = [];
  const refundRows: Row[] = [...(opts.refunds ?? [])];
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
    orderRefund: { create: async ({ data }: Row) => { refundRows.push(data); return data; } },
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
    staffMember: { findMany: async ({ where }: Row) => (opts.cards ?? []).filter((c) => c.tenantId === where.tenantId) },
    user: { findMany: async ({ where }: Row) => (opts.users ?? []).filter((u) => (!where?.tenantId || u.tenantId === where.tenantId) && (where?.isActive === undefined || u.isActive === where.isActive) && (!where?.approvalPinHash || !!u.approvalPinHash)) },
    orderRefund: { findMany: async ({ where }: Row) => refundRows.filter((r) => r.tenantId === where.tenantId && r.orderId === where.orderId) },
    cashShift: { findFirst: async ({ where }: Row) => (opts.shifts ?? []).find((x) => x.id === where.id && x.tenantId === where.tenantId) ?? null },
    orderItem: { updateMany: async ({ where, data }: Row) => { for (const o of orders) for (const l of (o.items ?? [])) if (l.id === where.id && o.id === where.orderId) Object.assign(l, data); return { count: 1 }; } },
    $transaction: async (fn: unknown) => (Array.isArray(fn) ? Promise.all(fn) : (fn as (t: Row) => Promise<unknown>)(tx)),
  };
  const svc = new PosService(
    prisma as never, { log: async (a: Row) => { audits.push(a); } } as never,
    { openShiftId: async () => opts.openShift ?? null } as never, {} as never,
    { reverseForRef: async () => undefined } as never, {} as never, { capture: async () => undefined } as never,
  );
  (svc as unknown as Row).recreditGiftCards = async () => undefined;
  return { svc, audits, moves, wheres, payments, orders, appts, refundRows };
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

describe('a part refund comes off the technician whose line it was', () => {
  const bill = () => paidBill({ discountCents: 1000, items: [
    { id: 'l1', kind: 'SERVICE', quantity: 1, lineTotalCents: 4500, tipCents: 600, staffMemberId: 'kim' },
    { id: 'l2', kind: 'SERVICE', quantity: 1, lineTotalCents: 1500, tipCents: 300, staffMemberId: 'hoa' },
  ] });
  it('the chosen line: its sale net of its discount share first, then its tip', async () => {
    const { svc, refundRows } = make({ orders: [bill()], payments: [mirror({ amountCents: 5900 })] });
    // l2's share of the $10 discount is $2.50 → $12.50 of sale, then $3 of tip.
    await svc.refundOrder(admin, 'o1', { amountCents: 1550, method: 'CASH', reason: 'x', itemIds: ['l2'] });
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]).toMatchObject({ tenantId: 't1', orderId: 'o1', full: false, amountCents: 1550 });
    expect(refundRows[0].lines).toEqual([{ itemId: 'l2', staffMemberId: 'hoa', kind: 'SERVICE', netCents: 1250, tipCents: 300 }]);
  });
  it('a second refund only takes what is left on the line', async () => {
    const earlier = { tenantId: 't1', orderId: 'o1', lines: [{ itemId: 'l2', staffMemberId: 'hoa', kind: 'SERVICE', netCents: 1250, tipCents: 0 }] };
    const { svc, refundRows } = make({ orders: [bill()], payments: [mirror({ amountCents: 5900 }), mirror({ amountCents: -1250 })], refunds: [earlier] });
    await svc.refundOrder(admin, 'o1', { amountCents: 500, method: 'CASH', reason: 'x', itemIds: ['l2'] });
    expect(refundRows[1].lines).toEqual([{ itemId: 'l2', staffMemberId: 'hoa', kind: 'SERVICE', netCents: 0, tipCents: 300 }]);
  });
  it('a full refund keeps the record but splits nothing (the whole bill leaves the books)', async () => {
    const { svc, refundRows } = make({ orders: [bill()], payments: [mirror({ amountCents: 5900 })] });
    await svc.refundOrder(admin, 'o1', { amountCents: 5900, method: 'CASH', reason: 'x' });
    expect(refundRows[0]).toMatchObject({ full: true, lines: [] });
  });
});

describe("a cashier needs a manager's PIN", () => {
  const cashier = { userId: 'c1', tenantId: 't1', role: 'STAFF', staffRole: 'RECEPTIONIST' } as never;
  const users = [
    { id: 'm1', tenantId: 't1', role: 'STAFF', isActive: true, approvalPinHash: 'h:4321' },
    { id: 'o1', tenantId: 't1', role: 'SALON_ADMIN', isActive: true, approvalPinHash: 'h:1111' },
    { id: 'x1', tenantId: 't2', role: 'SALON_ADMIN', isActive: true, approvalPinHash: 'h:9999' },
    { id: 'r1', tenantId: 't1', role: 'STAFF', isActive: true, approvalPinHash: 'h:5555' },
  ];
  const cards = [
    { tenantId: 't1', userId: 'm1', staffRole: 'MANAGER', permissions: null },
    { tenantId: 't1', userId: 'r1', staffRole: 'RECEPTIONIST', permissions: null },
  ];
  it('without one: refused, nothing moves', async () => {
    const { svc, payments } = make({ orders: [paidBill()], payments: [mirror()], users, cards });
    await expect(svc.refundOrder(cashier, 'o1', { amountCents: 500, method: 'CASH', reason: 'x' })).rejects.toThrow(/APPROVAL_PIN_REQUIRED/);
    expect(payments).toHaveLength(1);
  });
  it("with a manager's or the owner's PIN: done, and the approver is on the record", async () => {
    const { svc, audits } = make({ orders: [paidBill()], payments: [mirror()], users, cards });
    await svc.refundOrder(cashier, 'o1', { amountCents: 500, method: 'CASH', reason: 'x', approvalPin: '4321' });
    expect(audits.find((a) => a.action === 'order.refunded')!.metadata).toMatchObject({ approvedByUserId: 'm1' });
  });
  it("a receptionist's PIN, another salon's owner PIN, or a wrong PIN do not approve", async () => {
    for (const pin of ['5555', '9999', '0000']) {
      const { svc } = make({ orders: [paidBill()], payments: [mirror()], users, cards });
      await expect(svc.refundOrder({ ...(cashier as object), tenantId: 't1', userId: `c-${pin}` } as never, 'o1', { amountCents: 500, method: 'CASH', reason: 'x', approvalPin: pin })).rejects.toThrow(/PIN/);
    }
  });
  it('the owner / a manager needs no PIN', async () => {
    const { svc } = make({ orders: [paidBill()], payments: [mirror()], users, cards });
    await expect(svc.refundOrder({ userId: 'm1', tenantId: 't1', role: 'STAFF', staffRole: 'MANAGER' } as never, 'o1', { amountCents: 500, method: 'CASH', reason: 'x' })).resolves.toBeTruthy();
  });
});

describe('re-splitting a tip', () => {
  const bill = () => paidBill({ items: [
    { id: 'l1', kind: 'SERVICE', quantity: 1, lineTotalCents: 4500, tipCents: 900, staffMemberId: 'kim' },
    { id: 'l2', kind: 'SERVICE', quantity: 1, lineTotalCents: 1500, tipCents: 0, staffMemberId: 'hoa' },
  ] });
  it('moves the tip between lines, the total stays, and it is on the record', async () => {
    const { svc, orders, audits } = make({ orders: [bill()], payments: [mirror()] });
    (svc as unknown as Row).getOrder = async () => ({});
    await svc.setLineTips(admin, 'o1', [{ itemId: 'l1', tipCents: 500 }, { itemId: 'l2', tipCents: 400 }]);
    expect(orders[0].items.map((l: Row) => l.tipCents)).toEqual([500, 400]);
    expect(audits.find((a) => a.action === 'pos.order_tips_changed')).toMatchObject({ tenantId: 't1', resourceId: 'o1' });
  });
  it('refuses a split that changes the total, or a line of another bill / salon', async () => {
    const { svc, orders } = make({ orders: [bill()], payments: [mirror()] });
    await expect(svc.setLineTips(admin, 'o1', [{ itemId: 'l2', tipCents: 400 }])).rejects.toThrow(/giữ nguyên/);
    await expect(svc.setLineTips(admin, 'o1', [{ itemId: 'zz', tipCents: 0 }])).rejects.toThrow(/không thuộc/);
    await expect(svc.setLineTips(other, 'o1', [{ itemId: 'l1', tipCents: 900 }])).rejects.toThrow(/not found/i);
    expect(orders[0].items.map((l: Row) => l.tipCents)).toEqual([900, 0]);
  });
});

describe('a void belongs to its shift', () => {
  const manager = { userId: 'm1', tenantId: 't1', role: 'STAFF', staffRole: 'MANAGER' } as never;
  it('a manager voids while the shift is open, not once it is closed — the owner still can', async () => {
    const open = make({ orders: [paidBill({ shiftId: 's1' })], payments: [mirror()], shifts: [{ id: 's1', tenantId: 't1', status: 'OPEN' }] });
    (open.svc as unknown as Row).getOrder = async () => ({});
    await open.svc.voidOrder(manager, 'o1', { reason: 'Trùng bill' });
    expect(open.orders[0].status).toBe('VOID');

    const closed = make({ orders: [paidBill({ shiftId: 's1' })], payments: [mirror()], shifts: [{ id: 's1', tenantId: 't1', status: 'CLOSED' }] });
    await expect(closed.svc.voidOrder(manager, 'o1', { reason: 'Trùng bill' })).rejects.toThrow(/đã chốt/);
    expect(closed.orders[0].status).toBe('PAID');
    (closed.svc as unknown as Row).getOrder = async () => ({});
    await closed.svc.voidOrder(admin, 'o1', { reason: 'Trùng bill' });
    expect(closed.orders[0].status).toBe('VOID');
  });
  it('without shifts: only the same salon day', async () => {
    const old = make({ orders: [paidBill({ shiftId: null, paidAt: new Date('2026-01-02T15:00:00Z') })], payments: [mirror()] });
    await expect(old.svc.voidOrder(manager, 'o1', { reason: 'x' })).rejects.toThrow(/ngày đã qua/);
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
