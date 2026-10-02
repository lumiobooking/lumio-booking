// A developer machine may carry an older generated Prisma client (the one on
// Render is regenerated at every build); the enums this screen reads are
// supplied here so the test never depends on which client is installed.
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED', REFUNDED: 'REFUNDED' },
  OrderStatus: { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID', REFUNDED: 'REFUNDED' },
  WalkInStatus: { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  WaitlistStatus: { WAITING: 'WAITING', NOTIFIED: 'NOTIFIED', CONVERTED: 'CONVERTED', CANCELLED: 'CANCELLED' },
  GoogleReviewStatus: { NEW: 'NEW', DRAFTED: 'DRAFTED', REPLIED: 'REPLIED', NEEDS_ATTENTION: 'NEEDS_ATTENTION', SKIPPED: 'SKIPPED' },
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPPORT: 'SUPPORT' },
}));

import { UserRole } from '@prisma/client';
import { OverviewService } from './overview.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * The home screen is built from seven tables. This fake records every query,
 * so the test can prove two things without a database: the numbers come out
 * the way the screen expects them, and NOT ONE query goes out without the
 * caller's tenantId — a salon can never see another salon's floor.
 */
function makePrisma(now: Date) {
  const T = 'tenant-a';
  const calls: { model: string; where: any }[] = [];
  const rec = (model: string) => (args: any) => { calls.push({ model, where: args?.where }); return args; };
  const min = (n: number) => new Date(now.getTime() + n * 60000);
  const staff = [
    { id: 'st-linda', firstName: 'Linda', lastName: 'Ng' },
    { id: 'st-mai', firstName: 'Mai', lastName: null },
    { id: 'st-kevin', firstName: 'Kevin', lastName: null },
  ];
  const appts = [
    // Mai: in progress right now
    { id: 'a1', status: 'CONFIRMED', startTime: min(-20), endTime: min(30), assignedStaffId: 'st-mai', customer: { firstName: 'Jessica', lastName: 'Lee' }, service: { name: 'Deluxe Spa Pedicure' } },
    // Kevin: free now, next at +50
    { id: 'a2', status: 'ACCEPTED', startTime: min(50), endTime: min(110), assignedStaffId: 'st-kevin', customer: { firstName: 'Kim', lastName: 'L.' }, service: { name: 'Acrylic Full Set' } },
    // done earlier today
    { id: 'a3', status: 'COMPLETED', startTime: min(-180), endTime: min(-120), assignedStaffId: 'st-linda', customer: { firstName: 'Old', lastName: null }, service: { name: 'Manicure' } },
  ];
  const serving = [
    { id: 'w1', customerName: 'Anna Tran', items: [{ name: 'Gel Manicure' }, { name: 'Cuticle Care Extra' }], assignedStaffId: 'st-linda', assignedAt: min(-40), extraMinutes: null, awaitingPayment: true, service: { name: 'Gel Manicure', durationMinutes: 45 }, customer: null },
  ];
  const waiting = [
    // Waited 14 minutes: over the 10-minute line, so it is called out.
    { id: 'w-old', customerName: '', createdAt: min(-14), customer: { firstName: 'Grace', lastName: 'Lam' } },
    { id: 'w-new', customerName: 'Tom Ho', createdAt: min(-3), customer: null },
  ];
  const prisma: any = {
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    staffMember: { findMany: jest.fn(async (a: any) => { rec('staffMember')(a); return staff; }) },
    appointment: {
      findMany: jest.fn(async (a: any) => { rec('appointment')(a); return a.select?.status && !a.select.id ? appts.map((x) => ({ status: x.status })) : appts; }),
      count: jest.fn(async (a: any) => { rec('appointment.count')(a); return 3; }),
    },
    payment: { findMany: jest.fn(async (a: any) => { rec('payment')(a); return [{ amountCents: 4400, paidAt: min(-60), provider: 'pos-cash', type: 'ONSITE', appointment: null }]; }) },
    customer: { count: jest.fn(async (a: any) => { rec('customer.count')(a); return 2; }) },
    walkIn: { findMany: jest.fn(async (a: any) => { rec('walkIn')(a); return a?.where?.status === 'WAITING' ? waiting : serving; }) },
    station: { count: jest.fn(async (a: any) => { rec('station.count')(a); return 7; }) },
    waitlistEntry: { count: jest.fn(async (a: any) => { rec('waitlistEntry.count')(a); return 2; }) },
    googleReview: { count: jest.fn(async (a: any) => { rec('googleReview.count')(a); return 1; }) },
    product: { findMany: jest.fn(async (a: any) => { rec('product')(a); return [{ name: 'Hand Cream', stockQty: 3 }]; }) },
    order: { aggregate: jest.fn(async (a: any) => { rec('order.aggregate')(a); return { _sum: { tipCents: 18600 } }; }) },
    orderItem: { findMany: jest.fn(async (a: any) => { rec('orderItem')(a); return []; }) },
  };
  return { prisma, calls, T };
}

const owner: AuthenticatedUser = { userId: 'u-a', email: 'a@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };

describe('OverviewService.home', () => {
  it('describes the floor right now, with everyone waiting to pay first', async () => {
    const now = new Date('2026-09-29T15:42:00Z');
    const { prisma } = makePrisma(now);
    const svc = new OverviewService(prisma);
    jest.useFakeTimers().setSystemTime(now);
    try {
      const home = await svc.home(owner, '2026-09-29', '2026-09-29');
      // Linda is on a walk-in that is waiting to pay: she is the first row.
      expect(home.now.map((r: any) => r.name)).toEqual(['Linda Ng', 'Mai', 'Kevin']);
      expect(home.now[0].current).toMatchObject({ kind: 'walkin', customer: 'Anna Tran', service: 'Gel Manicure + Cuticle Care Extra', awaitingPayment: true });
      expect(home.now[1].current).toMatchObject({ kind: 'appointment', customer: 'Jessica Lee', service: 'Deluxe Spa Pedicure' });
      expect(home.now[2].current).toBeNull();
      expect(home.now[2].next).toMatchObject({ customer: 'Kim L.', service: 'Acrylic Full Set' });
      expect(home.chairs).toEqual({ total: 7, busy: 2, staff: 3 });
      expect(home.today).toMatchObject({ bookings: 3, completed: 1, inProgress: 1, upcoming: 1 });
      expect(home.attention).toMatchObject({ awaitingPayment: 1, pendingBookings: 3, waitlist: 2, reviews: 1, lowStock: [{ name: 'Hand Cream', qty: 3 }] });
      expect(home.tipsCents).toBe(18600);
      // The strip: Mai's appointment is in service (Linda's client is only
      // waiting to pay), two walk-ins queue, Kevin's 10:32 is within the hour.
      expect(home.floor).toEqual({ inService: 1, waiting: 2, nextHour: 1, freeTechs: 1, longestWait: { id: 'w-old', name: 'Grace Lam', minutes: 14 } });
      // The previous period is the same length (one day), ending yesterday.
      expect(home.previous.range).toEqual({ from: '2026-09-28', to: '2026-09-28' });
      expect(home.previous.kpis.revenueCents).toBe(4400);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never queries without the caller tenant (cross-tenant isolation)', async () => {
    const now = new Date('2026-09-29T15:42:00Z');
    const { prisma, calls } = makePrisma(now);
    const svc = new OverviewService(prisma);
    await svc.home(owner, '2026-09-22', '2026-09-29');
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c.where?.tenantId).toBe('tenant-a');
  });

  it('names no one when nobody has waited 10 minutes', async () => {
    const now = new Date('2026-09-29T15:42:00Z');
    const { prisma } = makePrisma(now);
    prisma.walkIn.findMany = jest.fn(async (a: any) => (a?.where?.status === 'WAITING' ? [{ id: 'w1', customerName: 'Tom', createdAt: new Date(now.getTime() - 9 * 60000), customer: null }] : []));
    const svc = new OverviewService(prisma);
    jest.useFakeTimers().setSystemTime(now);
    try {
      const home = await svc.home(owner, '2026-09-29', '2026-09-29');
      expect(home.floor.waiting).toBe(1);
      expect(home.floor.longestWait).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a 7-day window compares with the 7 days before it', async () => {
    const now = new Date('2026-09-29T15:42:00Z');
    const { prisma } = makePrisma(now);
    const svc = new OverviewService(prisma);
    const home = await svc.home(owner, '2026-09-23', '2026-09-29');
    expect(home.previous.range).toEqual({ from: '2026-09-16', to: '2026-09-22' });
  });
});
