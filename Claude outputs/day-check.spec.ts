/**
 * The end-of-day check: served-not-paid walk-ins, paid lines with no
 * technician, bookings left open, bookings completed by hand — for this salon
 * and this salon day only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    OrderStatus: actual.OrderStatus ?? { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID' },
    OrderItemKind: actual.OrderItemKind ?? { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
    AppointmentStatus: actual.AppointmentStatus ?? { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW' },
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

function build() {
  const seen: Row[] = [];
  const walkIns = [
    { id: 'w-paid', customerName: 'Anna', status: 'DONE', createdAt: new Date('2026-10-16T15:00:00Z'), assignedAt: null, doneAt: new Date('2026-10-16T16:00:00Z'), items: [{ name: 'Gel' }], assignedStaffId: 'lan' },
    { id: 'w-open', customerName: 'Mai', status: 'SERVING', createdAt: new Date('2026-10-16T17:00:00Z'), assignedAt: null, doneAt: null, items: [{ name: 'Pedicure' }, { name: 'Art' }], assignedStaffId: 'hoa' },
  ];
  const orders = [
    { id: 'o1', orderNumber: 10, paidAt: new Date('2026-10-16T16:10:00Z'), walkInId: 'w-paid', walkInIds: [], appointmentId: null, appointmentIds: [], items: [{ id: 'i1', kind: 'SERVICE', name: 'Gel', lineTotalCents: 4500, staffMemberId: 'lan', walkInId: 'w-paid' }] },
    { id: 'o2', orderNumber: 11, paidAt: new Date('2026-10-16T18:00:00Z'), walkInId: null, walkInIds: [], appointmentId: 'a-paid', appointmentIds: [], items: [{ id: 'i2', kind: 'SERVICE', name: 'Manicure', lineTotalCents: 3000, staffMemberId: null, walkInId: null }, { id: 'i3', kind: 'PRODUCT', name: 'Oil', lineTotalCents: 900, staffMemberId: null, walkInId: null }] },
  ];
  const appts = [
    { id: 'a-paid', startTime: new Date('2026-10-16T17:30:00Z'), status: 'COMPLETED', completedAt: new Date('2026-10-16T18:00:00Z'), priceCents: 3000, customer: { firstName: 'Linh', lastName: null } },
    { id: 'a-hand', startTime: new Date('2026-10-16T14:00:00Z'), status: 'COMPLETED', completedAt: new Date('2026-10-16T15:00:00Z'), priceCents: 6000, customer: { firstName: 'Thu', lastName: 'Le' } },
    { id: 'a-open', startTime: new Date('2026-10-16T13:00:00Z'), status: 'ARRIVED', completedAt: null, priceCents: 5000, customer: { firstName: 'Kim', lastName: null } },
    { id: 'a-later', startTime: new Date('2099-01-01T13:00:00Z'), status: 'CONFIRMED', completedAt: null, priceCents: 5000, customer: { firstName: 'Future', lastName: null } },
  ];
  const prisma: Row = {
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    walkIn: { findMany: async ({ where }: Row) => { seen.push(where); return where.tenantId === T1 ? walkIns : []; } },
    order: { findMany: async ({ where }: Row) => { seen.push(where); return where.tenantId === T1 ? orders : []; } },
    appointment: { findMany: async ({ where }: Row) => { seen.push(where); return where.tenantId === T1 ? appts : []; } },
  };
  const svc = new PosService(
    prisma as never,
    { log: async () => undefined } as never,
    { openShiftId: async () => null } as never,
    { getPosSettings: async () => ({ taxRatePercent: 0 }), getBookingRules: async () => ({ currency: 'USD' }) } as never,
    {} as never, {} as never, {} as never,
  );
  return { svc, seen };
}

describe('what today still owes the books', () => {
  it('finds the served-not-paid, the paid-not-credited, the open and the hand-completed', async () => {
    const { svc, seen } = build();
    const r = await svc.dayCheck(admin, '2026-10-16');
    expect(r.day).toBe('2026-10-16');
    // Anna's ticket is settled by o1; Mai is still in the chair with no sale.
    expect(r.unpaid.map((w) => w.id)).toEqual(['w-open']);
    expect(r.unpaid[0].services).toEqual(['Pedicure', 'Art']);
    // Only the SERVICE line without a tech counts; the product line does not.
    expect(r.unassigned).toEqual([{ orderId: 'o2', orderNumber: 11, items: [{ id: 'i2', name: 'Manicure', lineTotalCents: 3000 }] }]);
    // Kim arrived and nothing was recorded; the future booking is not "open" yet.
    expect(r.openBookings.map((a) => a.id)).toEqual(['a-open']);
    // Thu was completed by hand (no ticket); Linh's completion is covered by o2.
    expect(r.estimated.map((a) => a.id)).toEqual(['a-hand']);
    expect(r.estimated[0]).toMatchObject({ customerName: 'Thu Le', priceCents: 6000 });
    expect(r.counts).toEqual({ unpaid: 1, unassigned: 1, openBookings: 1, estimated: 1 });
    // Every query carried the tenant.
    for (const w of seen) expect(w.tenantId).toBe(T1);
  });

  it('another salon sees nothing of this one', async () => {
    const { svc } = build();
    const r = await svc.dayCheck(other, '2026-10-16');
    expect(r.counts).toEqual({ unpaid: 0, unassigned: 0, openBookings: 0, estimated: 0 });
  });
});
