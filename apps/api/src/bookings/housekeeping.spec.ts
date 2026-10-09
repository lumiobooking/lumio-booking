/**
 * The book tidies itself: a technician who never answered loses the booking,
 * and once a salon's own day is over its untouched bookings become no-shows —
 * each salon by its own clock, each write scoped to its own tenantId.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW' },
  RejectionType: { REJECTED: 'REJECTED', NO_RESPONSE: 'NO_RESPONSE' },
}));
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// 03:30 UTC on Oct 5 = 22:30 Oct 4 in Chicago (UTC-5), 10:30 Oct 5 in Hanoi (UTC+7).
const NOW = new Date('2026-10-05T03:30:00Z');
const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600000);

function make(appts: Row[], tz: Record<string, string>) {
  const writes: Row[] = [];
  const audits: Row[] = [];
  const rejections: Row[] = [];
  const reassigned: Row[] = [];
  const inStatus = (a: Row, cond: Row) => (cond.in ? cond.in.includes(a.status) : a.status === cond);
  const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    appointment: {
      findMany: async ({ where, distinct }: Row) => {
        let rows = appts.filter((a) => (!where.tenantId || a.tenantId === where.tenantId)
          && inStatus(a, where.status)
          && (!where.endTime || a.endTime < where.endTime.lt)
          && (!where.startTime || a.startTime < where.startTime.lt)
          && (!where.responseDeadline || (a.responseDeadline && a.responseDeadline < where.responseDeadline.lt))
          && (!where.assignedStaffId || a.assignedStaffId !== where.assignedStaffId.not));
        if (distinct) { const seen = new Set<string>(); rows = rows.filter((r) => !seen.has(r.tenantId) && seen.add(r.tenantId)); }
        return rows;
      },
      updateMany: async ({ where, data }: Row) => {
        writes.push(where);
        const hit = appts.filter((a) => where.id.in.includes(a.id) && a.tenantId === where.tenantId && inStatus(a, where.status));
        for (const a of hit) Object.assign(a, data);
        return { count: hit.length };
      },
    },
    bookingRejection: { create: async ({ data }: Row) => { rejections.push(data); return data; } },
    tenant: { findUnique: async ({ where }: Row) => ({ timezone: tz[where.id] ?? 'UTC' }) },
  };
  const svc = Object.create(BookingsService.prototype) as BookingsService & Row;
  svc.prisma = prisma;
  svc.audit = { log: async (e: Row) => { audits.push(e); } };
  svc.logger = { warn: () => undefined, log: () => undefined };
  svc.reassign = async (tenantId: string, id: string, actor: string | null) => { reassigned.push({ tenantId, id, actor }); return { reassigned: true }; };
  svc.settings = { getBookingRules: async (tenantId: string) => ({ staffMustAccept: mustAccept.has(tenantId), assignmentMode: 'auto' }) };
  return { svc, writes, audits, rejections, reassigned };
}
let mustAccept = new Set<string>(['t1', 't2']);

describe('silent technicians', () => {
  it('every salon with an expired hand-off gets its sweep, each scoped to itself', async () => {
    const { svc, rejections, reassigned } = make([
      { id: 'a1', tenantId: 't1', status: 'ASSIGNED', assignedStaffId: 'kim', responseDeadline: h(1) },
      { id: 'a2', tenantId: 't2', status: 'ASSIGNED', assignedStaffId: 'zoe', responseDeadline: h(2) },
      { id: 'a3', tenantId: 't1', status: 'ASSIGNED', assignedStaffId: 'kim', responseDeadline: new Date(NOW.getTime() + 600000) }, // still has time
      { id: 'a4', tenantId: 't1', status: 'ACCEPTED', assignedStaffId: 'kim', responseDeadline: h(3) }, // answered
    ], {});
    expect(await svc.processTimeoutsEverywhere(NOW)).toEqual({ tenants: 2, processed: 2, reassigned: 2 });
    expect(rejections.map((r) => [r.tenantId, r.appointmentId, r.type])).toEqual([['t1', 'a1', 'NO_RESPONSE'], ['t2', 'a2', 'NO_RESPONSE']]);
    expect(reassigned).toEqual([{ tenantId: 't1', id: 'a1', actor: null }, { tenantId: 't2', id: 'a2', actor: null }]);
  });
});

describe('a salon that does not ask technicians to tap Accept', () => {
  afterEach(() => { mustAccept = new Set(['t1', 't2']); });
  it('keeps the picked technician: the deadline is cleared, nothing is reassigned or marked', async () => {
    mustAccept = new Set(['t2']);
    const appts = [
      { id: 'a1', tenantId: 't1', status: 'ASSIGNED', assignedStaffId: 'kim', responseDeadline: h(1) },
      { id: 'a2', tenantId: 't2', status: 'ASSIGNED', assignedStaffId: 'zoe', responseDeadline: h(2) },
    ];
    const { svc, rejections, reassigned } = make(appts, {});
    expect(await svc.processTimeoutsEverywhere(NOW)).toEqual({ tenants: 2, processed: 1, reassigned: 1 });
    expect(appts[0]).toMatchObject({ assignedStaffId: 'kim', status: 'ASSIGNED', responseDeadline: null });
    expect(rejections.map((r) => r.tenantId)).toEqual(['t2']);
    expect(reassigned.map((r) => r.tenantId)).toEqual(['t2']);
  });
});

describe('bookings nobody came to', () => {
  it("closes yesterday's untouched bookings by each salon's own midnight, never one that arrived", async () => {
    const appts = [
      // Chicago salon: it is still Oct 4 there (22:30) — today's bookings stay open.
      { id: 'c-today', tenantId: 'chi', status: 'CONFIRMED', startTime: h(5), endTime: h(4) },
      { id: 'c-yday', tenantId: 'chi', status: 'CONFIRMED', startTime: h(30), endTime: h(29) },
      { id: 'c-arrived', tenantId: 'chi', status: 'ARRIVED', startTime: h(30), endTime: h(29) },
      // Hanoi salon: Oct 5 has begun (10:30) — yesterday's open bookings close.
      { id: 'h-yday', tenantId: 'han', status: 'PENDING', startTime: h(12), endTime: h(11) }, // 22:30 Oct 4 in Hanoi
      { id: 'h-today', tenantId: 'han', status: 'CONFIRMED', startTime: h(1.5), endTime: h(1.2) },
      { id: 'h-done', tenantId: 'han', status: 'COMPLETED', startTime: h(5), endTime: h(4) },
    ];
    const { svc, writes, audits } = make(appts, { chi: 'America/Chicago', han: 'Asia/Ho_Chi_Minh' });
    expect(await svc.closeMissedEverywhere(NOW)).toEqual({ tenants: 2, closed: 2 });
    const by = Object.fromEntries(appts.map((a) => [a.id, a.status]));
    expect(by).toEqual({ 'c-today': 'CONFIRMED', 'c-yday': 'NO_SHOW', 'c-arrived': 'ARRIVED', 'h-yday': 'NO_SHOW', 'h-today': 'CONFIRMED', 'h-done': 'COMPLETED' });
    for (const w of writes) expect(['chi', 'han']).toContain(w.tenantId);
    expect(audits.map((a) => [a.tenantId, a.resourceId, a.action])).toEqual([['chi', 'c-yday', 'booking.no_show_auto'], ['han', 'h-yday', 'booking.no_show_auto']]);
  });
});
