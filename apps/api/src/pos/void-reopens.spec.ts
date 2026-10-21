/**
 * A voided or deleted sale no longer pays for its booking: the booking goes
 * back to ARRIVED (payroll stops paying commission on it) — unless another
 * paid ticket still covers it. Never another salon's booking.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    OrderStatus: actual.OrderStatus ?? { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID' },
    OrderItemKind: actual.OrderItemKind ?? { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID', REFUNDED: 'REFUNDED' },
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED' },
  };
});
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
jest.mock('../feedback/feedback.service', () => ({ FeedbackService: class {} }));
import { PosService } from './pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;

function make(orders: Row[], appts: Row[], finalRuns: Row[] = []) {
  const apptWheres: Row[] = [];
  const tx: Row = {
    order: {
      updateMany: async ({ where, data }: Row) => { orders.filter((o) => o.id === where.id && o.tenantId === where.tenantId).forEach((o) => Object.assign(o, data)); return { count: 1 }; },
      findMany: async ({ where }: Row) => orders.filter((o) => o.tenantId === where.tenantId && o.status === where.status && o.id !== where.id.not
        && ((where.OR[0].appointmentId.in as string[]).includes(o.appointmentId) || (o.appointmentIds ?? []).some((x: string) => (where.OR[1].appointmentIds.hasSome as string[]).includes(x)))),
      deleteMany: async () => ({ count: 1 }),
    },
    payment: { updateMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 1 }) },
    product: { updateMany: async () => ({ count: 0 }) },
    appointment: {
      updateMany: async ({ where, data }: Row) => {
        apptWheres.push(where);
        const hit = appts.filter((a) => a.tenantId === where.tenantId && (where.id.in as string[]).includes(a.id) && a.status === where.status);
        hit.forEach((a) => Object.assign(a, data));
        return { count: hit.length };
      },
    },
  };
  const prisma: Row = {
    order: { findFirst: async ({ where }: Row) => { const o = orders.find((x) => x.id === where.id && x.tenantId === where.tenantId); return o ? { ...o, items: [] } : null; } },
    payment: { findMany: async () => [] },
    payrollRun: { findMany: async ({ where }: Row) => finalRuns.filter((r) => r.tenantId === where.tenantId) },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    $transaction: async (fn: (t: Row) => Promise<unknown>) => fn(tx),
  };
  const svc = new PosService(
    prisma as never, { log: async () => undefined } as never, {} as never, {} as never,
    { reverseForRef: async () => undefined } as never, {} as never, { capture: async () => undefined } as never,
  );
  (svc as unknown as Row).recreditGiftCards = async () => undefined;
  (svc as unknown as Row).getOrder = async () => ({});
  return { svc, apptWheres };
}

describe('a voided or deleted sale reopens its bookings', () => {
  it('void: the booking goes back to ARRIVED, completedAt cleared', async () => {
    const orders = [{ id: 'o1', tenantId: 't1', status: 'PAID', appointmentId: 'a1', appointmentIds: ['a1'], orderNumber: 1, totalCents: 4500, currency: 'USD' }];
    const appts = [{ id: 'a1', tenantId: 't1', status: 'COMPLETED', completedAt: new Date() }];
    const { svc, apptWheres } = make(orders, appts);
    await svc.voidOrder(admin, 'o1');
    expect(appts[0].status).toBe('ARRIVED');
    expect(appts[0].completedAt).toBeNull();
    for (const w of apptWheres) expect(w.tenantId).toBe('t1');
  });
  it('delete: a paid sale is never deleted (void it instead), its booking untouched', async () => {
    const orders = [{ id: 'o1', tenantId: 't1', status: 'PAID', appointmentId: 'a1', appointmentIds: ['a1'], orderNumber: 1, totalCents: 4500, currency: 'USD' }];
    const appts = [{ id: 'a1', tenantId: 't1', status: 'COMPLETED', completedAt: new Date() }];
    const { svc } = make(orders, appts);
    await expect(svc.removeOrder(admin, 'o1')).rejects.toThrow(/không xoá được/);
    expect(appts[0].status).toBe('COMPLETED');
  });
  it('a booking another paid ticket still covers stays COMPLETED', async () => {
    const orders = [
      { id: 'o1', tenantId: 't1', status: 'PAID', appointmentId: 'a1', appointmentIds: ['a1'], orderNumber: 1, totalCents: 4500, currency: 'USD' },
      { id: 'o2', tenantId: 't1', status: 'PAID', appointmentId: 'a1', appointmentIds: ['a1'], orderNumber: 2, totalCents: 4500, currency: 'USD' },
    ];
    const appts = [{ id: 'a1', tenantId: 't1', status: 'COMPLETED', completedAt: new Date() }];
    const { svc } = make(orders, appts);
    await svc.voidOrder(admin, 'o1');
    expect(appts[0].status).toBe('COMPLETED');
  });
});

describe('a sale inside a closed payroll is frozen', () => {
  it('void and delete are refused until the payroll is reopened; another salon\'s payroll does not matter', async () => {
    const order = () => [{ id: 'o1', tenantId: 't1', status: 'PAID', appointmentId: null, appointmentIds: [], orderNumber: 1, totalCents: 4500, currency: 'USD', paidAt: new Date('2026-10-05T18:00:00Z') }];
    const closed = [{ tenantId: 't1', periodFrom: '2026-10-01', periodTo: '2026-10-07' }];
    await expect(make(order(), [], closed).svc.voidOrder(admin, 'o1')).rejects.toThrow(/kỳ lương đã chốt/);
    // A paid sale is not deleted at all now — refused before the payroll is even looked at.
    await expect(make(order(), [], closed).svc.removeOrder(admin, 'o1')).rejects.toThrow(/không xoá được/);
    const other = make(order(), [], [{ tenantId: 't2', periodFrom: '2026-10-01', periodTo: '2026-10-07' }]);
    await other.svc.voidOrder(admin, 'o1');
  });
});
