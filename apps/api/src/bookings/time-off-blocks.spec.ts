/**
 * TIME OFF AND BLOCKS ARE NOT BOOKABLE.
 *
 *  - Approved time off took the technician off the booking page and the bots,
 *    but the desk could still type a booking onto her day off. Now every path
 *    that puts time on a technician refuses it — the desk and the owner too.
 *  - A temporary block from the Calendar is the same row; with no technician
 *    it blocks the WHOLE SALON, unassigned bookings included.
 *  - Blocks are made and removed per salon; one salon's block never touches
 *    another salon, even for the same ids.
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { TimeOffService } from '../staff/time-off.service';
import { blockingOff, busySpansFor, loadApprovedTimeOff, type TimeOffLite } from '../staff/time-off';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const owner: AuthenticatedUser = { userId: 'u-own', email: 'o@a.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };
const desk = { userId: 'u-desk', email: 'letan@a.test', role: UserRole.STAFF, tenantId: 'tenant-a', staffRole: 'RECEPTIONIST', capabilities: ['calendar', 'bookings'] } as unknown as AuthenticatedUser;
const deskB = { ...desk, userId: 'u-desk-b', tenantId: 'tenant-b' } as AuthenticatedUser;

const TZ = 'America/Los_Angeles'; // UTC-7 in June
const OPEN = { closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60 };
const HOURS = { businessHours: Array(7).fill(OPEN), daysOff: [], assignmentMode: 'none' };
// Saturday 2099-06-20 in Los Angeles.
const SAT_2PM = '2099-06-20T21:00:00.000Z';
const SAT_10AM = '2099-06-20T17:00:00.000Z';
const SAT_5PM = '2099-06-21T00:00:00.000Z';

const matches = (r: Row, w: Row): boolean => Object.entries(w).every(([k, v]) => {
  if (k === 'OR') return (v as Row[]).some((o) => matches(r, o));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('in' in v) return (v.in as unknown[]).includes(r[k]);
    if ('lte' in v) return r[k] <= v.lte;
    if ('gte' in v) return r[k] >= v.gte;
    return true;
  }
  return r[k] === v;
});

function make(offRows: Row[]) {
  const reads: Row[] = [];
  const timeOffRequest = { findMany: jest.fn(async ({ where }: Row) => { reads.push(where); return offRows.filter((r) => matches(r, where)); }) };
  const tenantFind = jest.fn(async ({ where }: Row) => ({ timezone: where.id === 'tenant-a' ? TZ : 'Asia/Ho_Chi_Minh', businessType: 'SALON' }));
  // Each salon has its own technician with the id "kim" (ids are only meaningful inside a salon).
  const staffFind = jest.fn(async ({ where }: Row) => ({ id: where.id ?? 'kim', firstName: where.tenantId === 'tenant-a' ? 'Kim' : 'Bao', isActive: true }));
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    customer: { upsert: jest.fn(async () => ({ id: 'cust-1' })), create: jest.fn(async () => ({ id: 'cust-1' })), findFirst: jest.fn(async () => null) },
    appointment: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: Row) => ({ id: 'appt-new', ...data })), updateMany: jest.fn(async () => ({ count: 1 })) },
    tenant: { findUnique: tenantFind },
    staffMember: { findFirst: staffFind },
    timeOffRequest,
  };
  const prisma = {
    service: { findFirst: jest.fn(async ({ where }: Row) => ({ id: 'svc-a', tenantId: where.tenantId, durationMinutes: 60, priceCents: 3500, currency: 'USD', isActive: true })) },
    staffMember: { findFirst: staffFind },
    appointment: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
    tenant: { findUnique: tenantFind },
    timeOffRequest,
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const settings = {
    getBookingRules: jest.fn(async () => HOURS),
    getNotificationSettings: jest.fn(async () => ({ emailCustomerOnBooking: false, emailAdminOnBooking: false, smsCustomerOnBooking: false, smsAdminOnBooking: false, smtp: {}, twilio: {} })),
  };
  const noop = { log: jest.fn(async () => undefined), send: jest.fn(async () => undefined), resolveReferrerId: jest.fn(async () => null), notifyNewBooking: jest.fn(async () => undefined), softDelete: jest.fn(async () => undefined), settleOnComplete: jest.fn(async () => undefined), rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: [], ranked: [] })) };
  const svc = new BookingsService(prisma as never, noop as never, noop as never, noop as never, settings as never, noop as never, noop as never, noop as never, noop as never);
  return { svc, prisma, tx, reads };
}
const dto = (startTime: string, extra: Row = {}) => ({ serviceId: 'svc-a', startTime, customerFirstName: 'linh', customerPhone: '+12135550100', ...extra }) as never;

const kimOff = { tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20', startTime: '13:00', endTime: '16:00' };
const salonBlock = { tenantId: 'tenant-a', staffId: null, status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20', startTime: '16:30', endTime: '18:00', reason: 'Private event' };

describe('the rule itself', () => {
  const offs: TimeOffLite[] = [kimOff, salonBlock];
  it('a partial block takes only its hours, for its technician', () => {
    expect(blockingOff(offs, 'kim', new Date(SAT_2PM), new Date(Date.parse(SAT_2PM) + 3600_000), TZ)).toBe(kimOff);
    expect(blockingOff(offs, 'kim', new Date(SAT_10AM), new Date(Date.parse(SAT_10AM) + 3600_000), TZ)).toBeNull();
    expect(blockingOff(offs, 'lisa', new Date(SAT_2PM), new Date(Date.parse(SAT_2PM) + 3600_000), TZ)).toBeNull();
  });
  it('a whole-salon block takes everyone, and a booking with no technician', () => {
    expect(blockingOff(offs, 'lisa', new Date(SAT_5PM), new Date(Date.parse(SAT_5PM) + 1800_000), TZ)).toBe(salonBlock);
    expect(blockingOff(offs, null, new Date(SAT_5PM), new Date(Date.parse(SAT_5PM) + 1800_000), TZ)).toBe(salonBlock);
    // …but a technician's time off never blocks an unassigned booking.
    expect(blockingOff(offs, null, new Date(SAT_2PM), new Date(Date.parse(SAT_2PM) + 3600_000), TZ)).toBeNull();
  });
  it('a booking that only RUNS INTO the block is caught too', () => {
    // 12:30–13:30 overlaps Kim's 13:00.
    const s = new Date('2099-06-20T19:30:00.000Z');
    expect(blockingOff(offs, 'kim', s, new Date(s.getTime() + 3600_000), TZ)).toBe(kimOff);
  });
  it('whole days block every hour of them, across midnight', () => {
    const days: TimeOffLite = { staffId: 'kim', startDate: '2099-06-21', endDate: '2099-06-22' };
    const lateSat = new Date('2099-06-21T06:30:00.000Z'); // Sat 11:30 PM LA, runs into Sunday
    expect(blockingOff([days], 'kim', lateSat, new Date(lateSat.getTime() + 3600_000), TZ)).toBe(days);
  });
  it('the shared loader also brings the whole-salon rows, inside one salon', async () => {
    const findMany = jest.fn(async () => []);
    await loadApprovedTimeOff({ timeOffRequest: { findMany } }, 'tenant-a', '2099-06-20', '2099-06-20', ['kim']);
    expect((findMany.mock.calls[0] as unknown as Row[])[0].where).toMatchObject({ tenantId: 'tenant-a', status: 'APPROVED', OR: [{ staffId: { in: ['kim'] } }, { staffId: null }] });
  });
  it('busy spans for availability include the salon block for any technician', () => {
    expect(busySpansFor([salonBlock], 'anyone', '2099-06-20', TZ)).toHaveLength(1);
    expect(busySpansFor([kimOff], 'anyone', '2099-06-20', TZ)).toHaveLength(0);
  });
});

describe('the desk cannot book onto time off', () => {
  it('the receptionist is refused with the technician and the time', async () => {
    const { svc, tx } = make([kimOff]);
    await expect(svc.create(desk, dto(SAT_2PM, { staffId: 'kim' }))).rejects.toThrow(ConflictException);
    await expect(svc.create(desk, dto(SAT_2PM, { staffId: 'kim' }))).rejects.toThrow(/^TIME_OFF: Kim is off 2099-06-20 13:00–16:00/);
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });
  it('the owner too — and "outside hours" does not get round it', async () => {
    const { svc } = make([kimOff]);
    await expect(svc.create(owner, dto(SAT_2PM, { staffId: 'kim', outsideHours: true }))).rejects.toThrow(/TIME_OFF/);
  });
  it('the same technician at another time is fine', async () => {
    const { svc } = make([kimOff]);
    const b: Row = await svc.create(desk, dto(SAT_10AM, { staffId: 'kim' }));
    expect(b.id).toBe('appt-new');
  });
  it('the online page and the bots are held to it as well', async () => {
    const { svc } = make([kimOff]);
    await expect(svc.createForTenant('tenant-a', dto(SAT_2PM, { staffId: 'kim' }), null, 'hosted')).rejects.toThrow(/TIME_OFF/);
  });
  it('moving a booking onto her time off is refused', async () => {
    const { svc, prisma, tx } = make([kimOff]);
    const booking = { id: 'b1', tenantId: 'tenant-a', status: 'CONFIRMED', startTime: new Date(SAT_10AM), endTime: new Date(Date.parse(SAT_10AM) + 3600_000), assignedStaffId: 'lisa' };
    (prisma.appointment as Row).findFirst = jest.fn(async ({ where }: Row) => (where.id === 'b1' && where.tenantId === 'tenant-a' ? booking : null));
    await expect(svc.move(desk, 'b1', SAT_2PM, 'kim')).rejects.toThrow(/TIME_OFF/);
    await expect(svc.assign(desk, 'b1', 'kim')).resolves.toBeDefined(); // 10 AM: she is in
    booking.startTime = new Date(SAT_2PM); booking.endTime = new Date(Date.parse(SAT_2PM) + 3600_000);
    await expect(svc.assign(desk, 'b1', 'kim')).rejects.toThrow(/TIME_OFF/);
    expect(tx.appointment.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('a whole-salon block', () => {
  it('refuses a booking with no technician, and any technician', async () => {
    const { svc } = make([salonBlock]);
    await expect(svc.create(desk, dto(SAT_5PM, { autoAssign: false }))).rejects.toThrow(/^BLOCKED: the salon has blocked 2099-06-20 16:30–18:00/);
    await expect(svc.create(desk, dto(SAT_5PM, { staffId: 'lisa' }))).rejects.toThrow(/BLOCKED/);
  });
  it('moving an unassigned booking into it is refused', async () => {
    const { svc, prisma } = make([salonBlock]);
    const booking = { id: 'b2', tenantId: 'tenant-a', status: 'PENDING', startTime: new Date(SAT_10AM), endTime: new Date(Date.parse(SAT_10AM) + 3600_000), assignedStaffId: null };
    (prisma.appointment as Row).findFirst = jest.fn(async ({ where }: Row) => (where.id === 'b2' && where.tenantId === 'tenant-a' ? booking : null));
    await expect(svc.reschedule(desk, 'b2', SAT_5PM)).rejects.toThrow(/BLOCKED/);
  });
  it("never touches another salon — salon B books the same instant freely and only reads its own rows", async () => {
    const { svc, reads } = make([salonBlock, kimOff]);
    const b: Row = await svc.create(deskB, dto(SAT_5PM, { autoAssign: false }));
    expect(b.tenantId).toBe('tenant-b');
    const b2: Row = await svc.create(deskB, dto(SAT_2PM, { staffId: 'kim' }));
    expect(b2.id).toBe('appt-new');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((w) => w.tenantId === 'tenant-b')).toBe(true);
  });
});

describe('making and removing blocks (Calendar)', () => {
  function timeOff(rows: Row[] = []) {
    const db = rows.map((r) => ({ ...r }));
    const logs: Row[] = [];
    const counts: Row[] = [];
    const prisma = {
      tenant: { findUnique: jest.fn(async () => ({ timezone: TZ })) },
      staffMember: { findFirst: jest.fn(async ({ where }: Row) => (where.tenantId === 'tenant-a' && where.id === 'kim' ? { id: 'kim', firstName: 'Kim', lastName: null, userId: null } : null)) },
      appointment: { count: jest.fn(async ({ where }: Row) => { counts.push(where); return 2; }) },
      timeOffRequest: {
        findMany: jest.fn(async ({ where }: Row) => db.filter((r) => r.tenantId === where.tenantId && (where.staffId === undefined || r.staffId === where.staffId) && (!where.status?.in || where.status.in.includes(r.status)) && (!where.id?.not || r.id !== where.id.not))),
        updateMany: jest.fn(async ({ where, data }: Row) => { const r = db.find((x) => x.id === where.id && x.tenantId === where.tenantId); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
        findFirst: jest.fn(async ({ where }: Row) => db.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
        create: jest.fn(async ({ data }: Row) => { const r = { id: `t${db.length + 1}`, createdAt: new Date(), decidedAt: null, decisionNote: null, ...data }; db.push(r); return r; }),
        deleteMany: jest.fn(async ({ where }: Row) => { const i = db.findIndex((r) => r.id === where.id && r.tenantId === where.tenantId); if (i >= 0) db.splice(i, 1); return { count: i >= 0 ? 1 : 0 }; }),
      },
    };
    const svc = new TimeOffService(prisma as never, { log: jest.fn(async (e: Row) => { logs.push(e); }) } as never, { sendToUser: jest.fn(async () => undefined), sendToTenant: jest.fn(async () => undefined) } as never);
    return { svc, db, logs, counts };
  }
  const NOW = new Date('2099-06-19T12:00:00Z');

  it('the desk blocks the WHOLE SALON for two hours — approved at once, audited, bookings inside counted', async () => {
    const { svc, db, logs, counts } = timeOff();
    const r: Row = await svc.addBlock(desk, { startDate: '2099-06-20', endDate: '2099-06-20', startTime: '16:30', endTime: '18:30', reason: 'Training' }, NOW);
    expect(r).toMatchObject({ wholeSalon: true, staffId: null, status: 'APPROVED', bookingsInside: 2 });
    expect(db[0]).toMatchObject({ tenantId: 'tenant-a', staffId: null, status: 'APPROVED' });
    expect(logs[0]).toMatchObject({ tenantId: 'tenant-a', userId: 'u-desk', action: 'calendar.block_added' });
    expect(counts[0].tenantId).toBe('tenant-a');
    expect(counts[0].assignedStaffId).toBeUndefined();
  });

  it('a block for one technician, whole days', async () => {
    const { svc, counts } = timeOff();
    const r: Row = await svc.addBlock(owner, { staffId: 'kim', startDate: '2099-06-20', endDate: '2099-06-21' }, NOW);
    expect(r).toMatchObject({ wholeSalon: false, staffId: 'kim' });
    expect(counts[0]).toMatchObject({ tenantId: 'tenant-a', assignedStaffId: 'kim' });
  });

  it("another salon's technician cannot be blocked", async () => {
    const { svc } = timeOff();
    await expect(svc.addBlock(deskB, { staffId: 'kim', startDate: '2099-06-20', endDate: '2099-06-20' }, NOW)).rejects.toThrow(NotFoundException);
  });

  it('two whole-salon blocks at the same time are refused', async () => {
    const { svc } = timeOff([{ id: 'x', tenantId: 'tenant-a', staffId: null, status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20', startTime: '16:00', endTime: '17:00' }]);
    await expect(svc.addBlock(desk, { startDate: '2099-06-20', endDate: '2099-06-20', startTime: '16:30', endTime: '18:30' }, NOW)).rejects.toThrow(ConflictException);
  });

  it('removes a block, but never leave the technician asked for, nor another salon’s row', async () => {
    const { svc, db, logs } = timeOff([
      { id: 'blk', tenantId: 'tenant-a', staffId: null, status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20', requestedByUserId: 'u-desk', decidedByUserId: 'u-desk' },
      { id: 'asked', tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-22', endDate: '2099-06-22', requestedByUserId: 'u-kim', decidedByUserId: 'u-own' },
    ]);
    await expect(svc.removeBlock(deskB, 'blk')).rejects.toThrow(NotFoundException);
    await expect(svc.removeBlock(desk, 'asked')).rejects.toThrow(ForbiddenException);
    await expect(svc.removeBlock(desk, 'blk')).resolves.toEqual({ ok: true });
    expect(db.map((r) => r.id)).toEqual(['asked']);
    expect(logs.at(-1)).toMatchObject({ tenantId: 'tenant-a', action: 'calendar.block_removed', resourceId: 'blk' });
  });

  it('the owner edits approved time off in the pop-up: new hours apply at once, audited, still approved', async () => {
    const { svc, db, logs } = timeOff([
      { id: 'off1', tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20', startTime: null, endTime: null, reason: 'Sick', requestedByUserId: 'u-own', decidedByUserId: 'u-own' },
    ]);
    const r: Row = await svc.edit(owner, 'off1', { startDate: '2099-06-20', endDate: '2099-06-20', startTime: '13:00', endTime: '16:00' }, NOW);
    expect(db[0]).toMatchObject({ staffId: 'kim', startTime: '13:00', endTime: '16:00', status: 'APPROVED', reason: 'Sick' });
    expect(r).toMatchObject({ status: 'APPROVED', startTime: '13:00', bookingsInside: 2 });
    expect(logs.at(-1)).toMatchObject({ tenantId: 'tenant-a', action: 'timeoff.edited', resourceId: 'off1', metadata: { before: '2099-06-20', after: '2099-06-20 13:00–16:00' } });
  });

  it('an edit that overlaps other leave of the same technician is refused; an end before the start too', async () => {
    const { svc } = timeOff([
      { id: 'a', tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20' },
      { id: 'b', tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-25', endDate: '2099-06-25' },
    ]);
    await expect(svc.edit(owner, 'b', { startDate: '2099-06-19', endDate: '2099-06-21' }, NOW)).rejects.toThrow(ConflictException);
    await expect(svc.edit(owner, 'b', { startDate: '2099-06-25', endDate: '2099-06-24' }, NOW)).rejects.toThrow(/before the first/);
    // Moving it onto its own days is not a clash with itself.
    await expect(svc.edit(owner, 'b', { startDate: '2099-06-25', endDate: '2099-06-26' }, NOW)).resolves.toBeDefined();
  });

  it("never edits another salon's row, nor moves it onto another salon's technician", async () => {
    const { svc, db } = timeOff([{ id: 'off1', tenantId: 'tenant-a', staffId: 'kim', status: 'APPROVED', startDate: '2099-06-20', endDate: '2099-06-20' }]);
    await expect(svc.edit(deskB, 'off1', { startDate: '2099-06-21', endDate: '2099-06-21' }, NOW)).rejects.toThrow(NotFoundException);
    await expect(svc.edit(owner, 'off1', { staffId: 'someone-else', startDate: '2099-06-21', endDate: '2099-06-21' }, NOW)).rejects.toThrow(NotFoundException);
    expect(db[0].startDate).toBe('2099-06-20');
  });

  it('a withdrawn or declined request cannot be edited back to life', async () => {
    const { svc } = timeOff([{ id: 'w', tenantId: 'tenant-a', staffId: 'kim', status: 'CANCELLED', startDate: '2099-06-20', endDate: '2099-06-20' }]);
    await expect(svc.edit(owner, 'w', { startDate: '2099-06-21', endDate: '2099-06-21' }, NOW)).rejects.toThrow(/closed/);
  });
});
