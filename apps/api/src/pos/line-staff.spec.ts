/**
 * Fixing who gets the credit on a PAID bill: only the technician on the chosen
 * lines changes, only inside this salon, never inside a finalised payroll.
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
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const T1 = 't1';
const admin = { userId: 'u1', tenantId: T1, role: 'SALON_ADMIN' } as never;
const other = { userId: 'u9', tenantId: 't2', role: 'SALON_ADMIN' } as never;

function build(opts: { finalRuns?: Row[]; staffIds?: string[] } = {}) {
  const updates: Row[] = [];
  const audits: Row[] = [];
  const order = {
    id: 'o1', tenantId: T1, orderNumber: 42, status: 'PAID', paidAt: new Date('2026-10-10T18:00:00Z'), customerId: 'c1',
    items: [
      { id: 'i1', kind: 'SERVICE', name: 'Gel Manicure', lineTotalCents: 4500, staffMemberId: null },
      { id: 'i2', kind: 'SERVICE', name: 'Pedicure', lineTotalCents: 5500, staffMemberId: 'lan' },
      { id: 'i3', kind: 'PRODUCT', name: 'Cuticle oil', lineTotalCents: 1200, staffMemberId: null },
    ],
    tenders: [],
  };
  const prisma: Row = {
    order: {
      findFirst: async ({ where }: Row) => (where.tenantId === T1 && where.id === 'o1' ? order : null),
      findMany: async ({ where }: Row) => (where.tenantId === T1 ? [order] : []),
    },
    orderItem: { updateMany: async (a: Row) => { updates.push(a); return { count: 1 }; } },
    staffMember: { findMany: async ({ where }: Row) => (opts.staffIds ?? ['lan', 'hoa']).filter((id) => where.id.in.includes(id) && where.tenantId === T1).map((id) => ({ id })) },
    payrollRun: { findMany: async () => opts.finalRuns ?? [] },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    customer: { findMany: async () => [{ id: 'c1', firstName: 'Anna', lastName: 'Le' }] },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const svc = new PosService(
    prisma as never,
    { log: async (a: Row) => { audits.push(a); } } as never,
    { openShiftId: async () => null } as never,
    { getPosSettings: async () => ({ taxRatePercent: 0 }), getBookingRules: async () => ({ currency: 'USD' }) } as never,
    {} as never, {} as never, {} as never,
  );
  return { svc, updates, audits };
}

describe('crediting a paid line to a technician after the fact', () => {
  it('changes only the chosen lines and logs who did it', async () => {
    const { svc, updates, audits } = build();
    await svc.setLineStaff(admin, 'o1', [{ itemId: 'i1', staffMemberId: 'hoa' }, { itemId: 'i2', staffMemberId: 'lan' }]);
    // i2 already had lan: no write for it.
    expect(updates).toEqual([{ where: { id: 'i1', orderId: 'o1' }, data: { staffMemberId: 'hoa' } }]);
    expect(audits[0].action).toBe('pos.order_staff_changed');
    expect(audits[0].metadata.changes).toEqual([{ itemId: 'i1', from: null, to: 'hoa' }]);
  });

  it('refuses a technician from another salon, and a line from another bill', async () => {
    const { svc, updates } = build({ staffIds: ['lan'] });
    await expect(svc.setLineStaff(admin, 'o1', [{ itemId: 'i1', staffMemberId: 'ghost' }])).rejects.toThrow(/không thuộc tiệm/);
    await expect(svc.setLineStaff(admin, 'o1', [{ itemId: 'nope', staffMemberId: 'lan' }])).rejects.toThrow(/không thuộc bill/);
    expect(updates).toHaveLength(0);
  });

  it('another salon cannot touch this bill at all', async () => {
    const { svc, updates } = build();
    await expect(svc.setLineStaff(other, 'o1', [{ itemId: 'i1', staffMemberId: 'lan' }])).rejects.toThrow(/not found/i);
    expect(updates).toHaveLength(0);
  });

  it('a bill inside a finalised payroll is frozen', async () => {
    const { svc, updates } = build({ finalRuns: [{ periodFrom: '2026-10-06', periodTo: '2026-10-12' }] });
    await expect(svc.setLineStaff(admin, 'o1', [{ itemId: 'i1', staffMemberId: 'lan' }])).rejects.toThrow(/kỳ lương đã chốt/);
    expect(updates).toHaveLength(0);
  });

  it('lists the paid SERVICE lines nobody was credited with, for this salon only', async () => {
    const { svc } = build();
    const mine = await svc.unassignedLines(admin);
    expect(mine.orders).toHaveLength(1);
    expect(mine.orders[0]).toMatchObject({ orderNumber: 42, customerName: 'Anna Le', day: '2026-10-10' });
    // The product line and the credited pedicure are not "unassigned" work.
    expect(mine.orders[0].items.map((i) => i.id)).toEqual(['i1']);
    const theirs = await svc.unassignedLines(other);
    expect(theirs.orders).toHaveLength(0);
  });
});
