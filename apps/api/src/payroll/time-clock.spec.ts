/**
 * CHẤM CÔNG: minutes per salon day, pay by the clock when the salon chooses,
 * and one salon / one technician at a time.
 */
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MAX_SHIFT_MIN, entryMinutes, minutesByDay, sanePunch } from './time-clock';
import { computePayslip, DEFAULT_PAYROLL_SETTINGS, PayConfig, sanitizeSettings } from './pay-calc';
import { TimeClockService } from './time-clock.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TZ = 'America/Edmonton'; // UTC-6 in October
const NOW = new Date('2026-10-08T22:00:00Z'); // Oct 8, 4 PM local

describe('minutes on the salon calendar', () => {
  it('a closed shift, today\'s open shift up to now, and one left open yesterday', () => {
    const r = minutesByDay([
      { id: 'a', clockIn: new Date('2026-10-07T16:00:00Z'), clockOut: new Date('2026-10-07T23:30:00Z') }, // Oct 7 10:00–17:30 = 450
      { id: 'b', clockIn: new Date('2026-10-08T15:00:00Z'), clockOut: null },                             // Oct 8 9:00 → now (16:00) = 420
      { id: 'c', clockIn: new Date('2026-10-06T15:00:00Z'), clockOut: null },                             // Oct 6, never closed
    ], TZ, NOW);
    expect(r.minutes).toEqual({ '2026-10-07': 450, '2026-10-08': 420 });
    expect(r.stale).toEqual(['c']);
  });
  it('a late shift stays on the day it started; a shift never counts more than 16 h', () => {
    expect(minutesByDay([{ id: 'x', clockIn: new Date('2026-10-08T03:00:00Z'), clockOut: new Date('2026-10-08T07:00:00Z') }], TZ, NOW).minutes).toEqual({ '2026-10-07': 240 });
    expect(entryMinutes({ id: 'y', clockIn: new Date('2026-10-07T00:00:00Z'), clockOut: new Date('2026-10-08T12:00:00Z') }, TZ, NOW)).toBe(MAX_SHIFT_MIN);
    expect(sanePunch(new Date(NOW.getTime() + 3600_000), NOW)).toBe(false);
  });
});

describe('paying by the clock', () => {
  const cfg = (p: Partial<PayConfig>): PayConfig => ({
    staffId: 'kim', name: 'Kim', payType: 'COMMISSION', commissionPercent: 60, productCommissionPercent: 0, hourlyRateCents: 0,
    dailyGuaranteeCents: 0, salaryCents: 0, salaryPeriod: 'MONTHLY', checkPercent: null,
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00' })), ...p,
  });
  const WEEK = { from: '2026-09-28', to: '2026-10-04' };
  const clock = { '2026-09-28': 300, '2026-09-29': 450 }; // 12.5 h on 2 days

  it('default SCHEDULE: unchanged — the schedule\'s hours', () => {
    const p = computePayslip({ cfg: cfg({ payType: 'HOURLY', hourlyRateCents: 2000 }), ledger: null, period: WEEK, settings: DEFAULT_PAYROLL_SETTINGS, clock });
    expect(p.hours).toBe(56);
    expect(p.hoursSource).toBe('SCHEDULE');
  });
  it('CLOCK: hourly pay from clocked hours; an owner\'s hours override still wins', () => {
    const S = sanitizeSettings({ hoursSource: 'CLOCK' });
    const p = computePayslip({ cfg: cfg({ payType: 'HOURLY', hourlyRateCents: 2000 }), ledger: null, period: WEEK, settings: S, clock });
    expect(p).toMatchObject({ hours: 12.5, hourlyPayCents: 25000, daysWorked: 2, hoursSource: 'CLOCK', clockedHours: 12.5 });
    expect(computePayslip({ cfg: cfg({ payType: 'HOURLY', hourlyRateCents: 2000 }), ledger: null, period: WEEK, settings: S, clock, override: { hours: 20 } }).hours).toBe(20);
  });
  it('CLOCK: the daily guarantee is paid on the days she clocked in', () => {
    const S = sanitizeSettings({ hoursSource: 'CLOCK' });
    const p = computePayslip({ cfg: cfg({ payType: 'DAILY_GUARANTEE', dailyGuaranteeCents: 10000 }), ledger: null, period: WEEK, settings: S, clock });
    expect(p.daysWorked).toBe(2);
    expect(p.earningsCents).toBe(20000);
  });
});

describe('the clock service, one salon and one technician at a time', () => {
  function make(seed: Row[] = [], settings: Record<string, Row> = {}) {
    const entries: Row[] = [...seed];
    const seen: string[] = [];
    const prisma: Row = {
      setting: { findUnique: async ({ where }: Row) => { seen.push(where.tenantId_key.tenantId); const v = settings[where.tenantId_key.tenantId]; return v ? { value: v } : null; } },
      tenant: { findUnique: async () => ({ timezone: TZ }) },
      staffMember: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); if (where.userId) return where.tenantId === 'A' && where.userId === 'u-kim' ? { id: 'kim' } : null; return where.tenantId === 'A' && where.id === 'kim' ? { id: 'kim' } : null; } },
      timeEntry: {
        findMany: async ({ where }: Row) => { seen.push(where.tenantId); return entries.filter((e) => e.tenantId === where.tenantId && (!where.staffId || e.staffId === where.staffId)).sort((a, b) => b.clockIn - a.clockIn); },
        findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return entries.filter((e) => e.tenantId === where.tenantId && (!where.id || e.id === where.id) && (!where.staffId || e.staffId === where.staffId) && (where.clockOut !== null || e.clockOut === null)).sort((a, b) => b.clockIn - a.clockIn)[0] ?? null; },
        create: async ({ data }: Row) => { const r = { id: `e${entries.length + 1}`, clockOut: null, note: null, ...data }; entries.push(r); return r; },
        updateMany: async ({ where, data }: Row) => { seen.push(where.tenantId); entries.filter((e) => e.id === where.id && e.tenantId === where.tenantId).forEach((e) => Object.assign(e, data)); return { count: 1 }; },
        deleteMany: async ({ where }: Row) => { seen.push(where.tenantId); return { count: 1 }; },
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new TimeClockService(prisma as never, audit as never), entries, seen, audit };
  }
  const kim = { userId: 'u-kim', tenantId: 'A', role: 'STAFF' } as never;
  const owner = (t: string) => ({ userId: 'own', tenantId: t, role: 'SALON_ADMIN' } as never);

  it('in, then out; twice in on one day is refused', async () => {
    const { svc, entries, seen } = make();
    await svc.clockIn(kim, new Date('2026-10-08T15:00:00Z'));
    await expect(svc.clockIn(kim, new Date('2026-10-08T16:00:00Z'))).rejects.toBeInstanceOf(ConflictException);
    const r: Row = await svc.clockOut(kim, NOW);
    expect(entries[0]).toMatchObject({ tenantId: 'A', staffId: 'kim', source: 'app' });
    expect(entries[0].clockOut).toEqual(NOW);
    expect(r.todayMinutes).toBe(420);
    expect(seen.every((t) => t === 'A')).toBe(true);
  });

  it('a shift left open yesterday cannot be closed from the app today — the owner fixes it', async () => {
    const { svc } = make([{ id: 'old', tenantId: 'A', staffId: 'kim', clockIn: new Date('2026-10-07T15:00:00Z'), clockOut: null, source: 'app', note: null }]);
    await expect(svc.clockOut(kim, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const r: Row = await svc.mine(kim, NOW);
    expect(r.stale).toHaveLength(1);
  });

  it('the owner adds and edits in salon time; never another salon\'s technician or entry', async () => {
    const { svc, entries, audit } = make([{ id: 'x', tenantId: 'B', staffId: 'zoe', clockIn: new Date('2026-10-07T15:00:00Z'), clockOut: null, source: 'app', note: null }]);
    const row: Row = await svc.create(owner('A'), { staffId: 'kim', clockIn: '2026-10-07T09:00', clockOut: '2026-10-07T17:30' }, NOW);
    expect(row.clockIn.toISOString()).toBe('2026-10-07T15:00:00.000Z');
    expect(row.clockOut.toISOString()).toBe('2026-10-07T23:30:00.000Z');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'time.entry_added' }));
    await expect(svc.create(owner('B'), { staffId: 'kim', clockIn: '2026-10-07T09:00' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.edit(owner('A'), 'x', { clockOut: '2026-10-07T17:00' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.create(owner('A'), { staffId: 'kim', clockIn: '2026-10-07T09:00', clockOut: '2026-10-07T08:00' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(entries.find((e) => e.id === 'x')!.clockOut).toBeNull();
  });

  it('the card only shows where the salon pays by the clock or someone used it', async () => {
    expect(((await make().svc.mine(kim, NOW)) as Row).inUse).toBe(false);
    expect(((await make([], { A: { hoursSource: 'CLOCK' } }).svc.mine(kim, NOW)) as Row).inUse).toBe(true);
    // Another salon paying by the clock changes nothing here.
    expect(((await make([], { B: { hoursSource: 'CLOCK' } }).svc.mine(kim, NOW)) as Row).inUse).toBe(false);
    const used = make([{ id: 'e1', tenantId: 'A', staffId: 'kim', clockIn: new Date('2026-10-07T15:00:00Z'), clockOut: new Date('2026-10-07T23:00:00Z'), source: 'admin', note: null }]);
    expect(((await used.svc.mine(kim, NOW)) as Row).inUse).toBe(true);
  });

  it('a login with no staff profile in this salon has no clock', async () => {
    await expect(make().svc.mine({ userId: 'u-kim', tenantId: 'B', role: 'STAFF' } as never, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
