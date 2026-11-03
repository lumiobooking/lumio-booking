/**
 * "Dò lại phần báo cáo marketing xem đã hoàn toàn đúng và chính xác chưa"
 * (3 Nov 2026). The numbers the monthly report is written from:
 *  - a cancelled appointment is not a booking (counted on its own line);
 *  - a visit's revenue counts in the visit's month, deposits paid earlier included;
 *  - an imported client list is not "new customers";
 *  - a review counts in the month Google says it was written;
 *  - month close happens on each salon's own clock, and a draft written
 *    mid-month is redrafted (and never auto-sent) once the month is over;
 *  - nothing of another salon is ever counted.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus ?? { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW' },
    PaymentStatus: actual.PaymentStatus ?? { PAID: 'PAID', PENDING: 'PENDING' },
    TenantStatus: actual.TenantStatus ?? { ACTIVE: 'ACTIVE' },
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN' },
  };
});
import { MarketingService, reportIsPartial } from './marketing.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A tiny where-evaluator: equality, null, {gte,lte}, {in}, {not:null}, OR. */
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
    const x = row[k];
    if (v === null) return x == null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(x);
      if ('not' in v) return v.not === null ? x != null : x !== v.not;
      if ('gte' in v || 'lte' in v) return x != null && (!v.gte || x >= v.gte) && (!v.lte || x <= v.lte);
      return true;
    }
    return x === v;
  });
}

const D = (s: string) => new Date(s);
function world() {
  const appointments: Row[] = [
    { id: 'a1', tenantId: 't1', status: 'COMPLETED', source: 'online', startTime: D('2026-11-03T17:00:00Z') },
    { id: 'a2', tenantId: 't1', status: 'CANCELLED', source: 'online', startTime: D('2026-11-04T17:00:00Z') },
    { id: 'a3', tenantId: 't1', status: 'NO_SHOW', source: 'phone', startTime: D('2026-11-05T17:00:00Z') },
    { id: 'b1', tenantId: 't2', status: 'COMPLETED', source: 'online', startTime: D('2026-11-03T17:00:00Z') },
  ];
  const payments: Row[] = [
    { tenantId: 't1', status: 'PAID', appointmentId: 'a1', amountCents: 2000, paidAt: D('2026-10-28T20:00:00Z') }, // deposit, last month
    { tenantId: 't1', status: 'PAID', appointmentId: 'a1', amountCents: 4000, paidAt: D('2026-11-03T18:00:00Z') },
    { tenantId: 't1', status: 'PAID', appointmentId: 'a2', amountCents: 1000, paidAt: D('2026-11-01T18:00:00Z') }, // cancelled visit
    { tenantId: 't2', status: 'PAID', appointmentId: 'b1', amountCents: 9900, paidAt: D('2026-11-03T18:00:00Z') },
  ];
  const customers: Row[] = [
    { tenantId: 't1', createdAt: D('2026-11-02T10:00:00Z'), importedAt: null, referredById: null },
    { tenantId: 't1', createdAt: D('2026-11-02T10:00:00Z'), importedAt: D('2026-11-02T10:00:00Z'), referredById: null },
    { tenantId: 't1', createdAt: D('2026-11-02T10:00:00Z'), importedAt: D('2026-11-02T10:00:00Z'), referredById: null },
    { tenantId: 't2', createdAt: D('2026-11-02T10:00:00Z'), importedAt: null, referredById: null },
  ];
  const reviews: Row[] = [
    { tenantId: 't1', reviewCreatedAt: D('2026-11-10T10:00:00Z'), createdAt: D('2026-11-10T11:00:00Z') },
    { tenantId: 't1', reviewCreatedAt: D('2024-05-01T10:00:00Z'), createdAt: D('2026-11-02T00:00:00Z') }, // old review, first mirrored this month
  ];
  const list = (rows: Row[]) => ({ findMany: async ({ where }: Row) => rows.filter((r) => match(r, where)), count: async ({ where }: Row) => rows.filter((r) => match(r, where)).length });
  const none = { findMany: async () => [], count: async () => 0 };
  const prisma: Row = {
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    appointment: list(appointments),
    payment: list(payments),
    customer: list(customers),
    googleReview: list(reviews),
    reviewClick: none, messengerThread: none, voiceCall: none, emailCampaign: none,
  };
  return prisma;
}
const admin = (tenantId: string) => ({ userId: 'u', tenantId, role: 'SALON_ADMIN' } as never);
const make = (prisma: Row) => new MarketingService(prisma as never, {} as never, {} as never, {} as never);

describe('the numbers a monthly report is written from', () => {
  it('bookings leave out cancelled ones; revenue is the visits\' money whenever paid; imports are not new customers', async () => {
    const ov = await make(world()).overview(admin('t1'), '2026-11-01', '2026-11-30');
    expect(ov.totals.bookings).toBe(2);      // a1 + a3 (a no-show was still booked)
    expect(ov.totals.cancelled).toBe(1);     // a2, on its own line
    expect(ov.totals.showed).toBe(1);
    expect(ov.totals.revenueCents).toBe(6000); // deposit (paid 28 Oct) + balance; the cancelled visit's 1000 is not revenue
    expect(ov.newCustomers).toBe(1);         // two imported clients are not new
    expect(ov.owned.googleReviews).toBe(1);  // a 2024 review mirrored this month is not this month's
  });
  it('one salon\'s report never counts another salon\'s bookings, money or clients', async () => {
    const ov = await make(world()).overview(admin('t2'), '2026-11-01', '2026-11-30');
    expect(ov.totals).toMatchObject({ bookings: 1, revenueCents: 9900, cancelled: 0 });
    expect(ov.newCustomers).toBe(1);
    await expect(make(world()).overview(admin('t1'), '2026-11-01', '2026-11-30', 't2')).rejects.toBeTruthy();
  });
});

describe('month close', () => {
  it('a report holding mid-month numbers is partial', () => {
    expect(reportIsPartial({ facts: { state: 'to-date' } })).toBe(true);
    expect(reportIsPartial({ running: true })).toBe(true);
    expect(reportIsPartial({ running: false, facts: { state: 'closed' } })).toBe(false);
    expect(reportIsPartial(null)).toBe(false);
  });

  function closeWorld(existing: Row[] = []) {
    const tenants = [{ id: 'la', timezone: 'America/Los_Angeles' }, { id: 'hcm', timezone: 'Asia/Ho_Chi_Minh' }, { id: 'stale', timezone: 'Asia/Ho_Chi_Minh' }, { id: 'done', timezone: 'Asia/Ho_Chi_Minh' }];
    const prisma: Row = {
      tenant: { findMany: async () => tenants },
      marketingReport: { findUnique: async ({ where }: Row) => existing.find((r) => r.tenantId === where.tenantId_periodMonth.tenantId && r.periodMonth === where.tenantId_periodMonth.periodMonth) ?? null },
      marketingSpend: { count: async () => 0 },
      appointment: { count: async () => 3 },
    };
    const svc = make(prisma);
    const drafted: string[] = [];
    (svc as unknown as Row).generateReport = async (_u: unknown, month: string, tenantId: string) => { drafted.push(`${tenantId}:${month}`); };
    (svc as unknown as Row).syncAllChannels = async () => undefined;
    (svc as unknown as Row).notifyDraftReady = async () => undefined;
    return { svc, drafted };
  }

  it('each salon closes its month at its own midnight; a mid-month draft is redrafted, an approved one left alone', async () => {
    const { svc, drafted } = closeWorld([
      { tenantId: 'stale', periodMonth: '2026-10', status: 'review', dataSnapshot: { facts: { state: 'to-date' } } },
      { tenantId: 'done', periodMonth: '2026-10', status: 'approved', dataSnapshot: { facts: { state: 'to-date' } } },
    ]);
    // 03:00 UTC on 1 Nov: 8 pm on 31 Oct in Los Angeles, 10 am on 1 Nov in Ho Chi Minh City.
    await svc.runMonthlyAutoGenerate(undefined, D('2026-11-01T03:00:00Z'));
    expect(drafted.sort()).toEqual(['hcm:2026-10', 'stale:2026-10']);
    // Later that day Los Angeles has turned the page too.
    const later = closeWorld();
    await later.svc.runMonthlyAutoGenerate(undefined, D('2026-11-01T09:00:00Z'));
    expect(later.drafted).toContain('la:2026-10');
  });
});
