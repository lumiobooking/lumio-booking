/**
 * NGHỈ PHÉP: an approved request takes the technician off the engine, the
 * booking page and payroll's worked days — for one salon at a time.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { blocksSlot, busySpansFor, overlaps, validateRequest, wholeDaysOff } from './time-off';
import { TimeOffService } from './time-off.service';
import { AssignmentService } from '../assignment/assignment.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TZ = 'America/Edmonton'; // UTC-6 in October
const NOW = new Date('2026-10-08T22:00:00Z'); // Oct 8, 4 PM local

describe('what a block covers', () => {
  const whole = { staffId: 'kim', startDate: '2026-10-10', endDate: '2026-10-12' };
  const part = { staffId: 'kim', startDate: '2026-10-10', endDate: '2026-10-10', startTime: '13:00', endTime: '17:00' };
  it('whole days take every slot of those days; a part of a day only its hours', () => {
    expect(blocksSlot(whole, '2026-10-11', 540, 600)).toBe(true);
    expect(blocksSlot(whole, '2026-10-13', 540, 600)).toBe(false);
    expect(blocksSlot(part, '2026-10-10', 540, 600)).toBe(false);   // 9–10, before
    expect(blocksSlot(part, '2026-10-10', 720, 800)).toBe(true);    // 12–13:20, overlaps
    expect(blocksSlot(part, '2026-10-10', 1020, 1080)).toBe(false); // 17–18, after
  });
  it('as busy spans in salon time; another technician gets none', () => {
    const b = busySpansFor([whole, part], 'kim', '2026-10-10', TZ);
    expect(b).toHaveLength(2);
    expect(b[0].start.toISOString()).toBe('2026-10-10T06:00:00.000Z');
    expect(b[1].start.toISOString()).toBe('2026-10-10T19:00:00.000Z');
    expect(busySpansFor([whole], 'lisa', '2026-10-10', TZ)).toEqual([]);
  });
  it('whole days off per technician, clipped to the period; parts of a day are not days off', () => {
    const m = wholeDaysOff([whole, part, { staffId: 'lisa', startDate: '2026-10-01', endDate: '2026-10-31' }], '2026-10-05', '2026-10-11');
    expect(m.get('kim')).toEqual(['2026-10-10', '2026-10-11']);
    expect(m.get('lisa')).toHaveLength(7);
  });
  it('overlap and validation', () => {
    expect(overlaps(whole, { staffId: 'kim', startDate: '2026-10-12', endDate: '2026-10-14' })).toBe(true);
    expect(overlaps(part, { staffId: 'kim', startDate: '2026-10-10', endDate: '2026-10-10', startTime: '09:00', endTime: '12:00' })).toBe(false);
    expect(overlaps(whole, { ...whole, staffId: 'lisa' })).toBe(false);
    expect(validateRequest({ startDate: '2026-10-10', endDate: '2026-10-09' }, '2026-10-08')).toBeTruthy();
    expect(validateRequest({ startDate: '2026-10-01', endDate: '2026-10-02' }, '2026-10-08')).toBeTruthy();
    expect(validateRequest({ startDate: '2026-10-10', endDate: '2026-10-11', startTime: '13:00', endTime: '15:00' }, '2026-10-08')).toBeTruthy();
    expect(validateRequest({ startDate: '2026-10-10', endDate: '2026-10-10', startTime: '13:00', endTime: '15:00' }, '2026-10-08')).toBeNull();
  });
});

describe('the engine skips a technician on leave', () => {
  const T = (id: string, tenantId = 't1') => ({ id, tenantId, firstName: id, lastName: null, isActive: true, takesAppointments: true, performanceScore: 100, staffServices: [], workingHours: [] });
  function make(team: Row[], leave: Row[]) {
    const seen: Row[] = [];
    const prisma = {
      tenant: { findUnique: async () => ({ timezone: TZ }) },
      assignmentRule: { findMany: async () => [] },
      staffMember: { findMany: async ({ where }: Row) => team.filter((s) => s.tenantId === where.tenantId) },
      appointment: { findFirst: async () => null, count: async () => 0 },
      bookingRejection: { count: async () => 0 },
      timeOffRequest: { findMany: async ({ where }: Row) => { seen.push(where); return leave.filter((l) => l.tenantId === where.tenantId && where.status === 'APPROVED'); } },
    };
    return { svc: new AssignmentService(prisma as never), seen };
  }
  // Oct 10, 10:00–11:00 local
  const appt = { id: 'a1', serviceId: 'gel', startTime: new Date('2026-10-10T16:00:00Z'), endTime: new Date('2026-10-10T17:00:00Z'), preferredStaffId: null };

  it('a whole day off, a morning off, and another salon\'s leave that means nothing here', async () => {
    const { svc, seen } = make([T('kim'), T('lisa'), T('ana')], [
      { tenantId: 't1', staffId: 'kim', startDate: '2026-10-10', endDate: '2026-10-10' },
      { tenantId: 't1', staffId: 'lisa', startDate: '2026-10-10', endDate: '2026-10-10', startTime: '09:00', endTime: '12:00' },
      { tenantId: 't2', staffId: 'ana', startDate: '2026-10-10', endDate: '2026-10-10' },
    ]);
    const r = await svc.rankEligibleStaff('t1', appt);
    expect(r.orderedStaffIds).toEqual(['ana']);
    const why = await svc.explain('t1', appt);
    expect(why).toMatchObject({ onShift: 1, onLeave: 2, free: ['ana'] });
    expect(seen.every((w) => w.tenantId === 't1')).toBe(true);
  });
});

describe('asking, deciding — one salon and one technician at a time', () => {
  function make(seed: Row[] = []) {
    const rows: Row[] = [...seed];
    const seen: string[] = [];
    const push = { sendToTenant: jest.fn(async () => undefined), sendToUser: jest.fn(async () => 1) };
    const audit = { log: jest.fn() };
    const staff: Row[] = [
      { id: 'kim', tenantId: 'A', userId: 'u-kim', firstName: 'Kim', lastName: null },
      { id: 'zoe', tenantId: 'B', userId: 'u-zoe', firstName: 'Zoe', lastName: null },
    ];
    const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => {
      if (k === 'status' && v && typeof v === 'object') return (v as Row).in.includes(r.status);
      if (k === 'startDate') return r.startDate <= (v as Row).lte;
      if (k === 'endDate') return r.endDate >= (v as Row).gte;
      if (k === 'id' && v && typeof v === 'object') return r.id !== (v as Row).not;
      return r[k] === v;
    });
    const withStaff = (r: Row) => ({ ...r, staff: staff.find((s) => s.id === r.staffId) ?? null });
    const prisma: Row = {
      tenant: { findUnique: async () => ({ timezone: TZ }) },
      staffMember: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return staff.find((s) => s.tenantId === where.tenantId && (where.userId ? s.userId === where.userId : s.id === where.id)) ?? null; } },
      timeOffRequest: {
        findMany: async ({ where }: Row) => { seen.push(where.tenantId); return rows.filter((r) => match(r, where)).map(withStaff); },
        findFirst: async ({ where }: Row) => { seen.push(where.tenantId); const r = rows.find((r) => match(r, where)); return r ? withStaff(r) : null; },
        count: async ({ where }: Row) => rows.filter((r) => match(r, where)).length,
        create: async ({ data }: Row) => { const r = { id: `r${rows.length + 1}`, reason: null, startTime: null, endTime: null, decidedAt: null, decisionNote: null, decidedByUserId: null, createdAt: NOW, ...data }; rows.push(r); return r; },
        updateMany: async ({ where, data }: Row) => { seen.push(where.tenantId); rows.filter((r) => match(r, where)).forEach((r) => Object.assign(r, data)); return { count: 1 }; },
        deleteMany: async ({ where }: Row) => { seen.push(where.tenantId); return { count: 1 }; },
      },
    };
    return { svc: new TimeOffService(prisma as never, audit as never, push as never), rows, seen, push, audit };
  }
  const kim = { userId: 'u-kim', tenantId: 'A', role: 'STAFF' } as never;
  const owner = (t: string) => ({ userId: `own-${t}`, tenantId: t, role: 'SALON_ADMIN' } as never);

  it('she asks → PENDING, the owner is woken; the same days twice is refused; the owner approves → she is told', async () => {
    const { svc, rows, push, seen } = make();
    const r: Row = await svc.request(kim, { startDate: '2026-10-20', endDate: '2026-10-21', reason: 'về quê' }, NOW);
    expect(r).toMatchObject({ staffId: 'kim', status: 'PENDING', reason: 'về quê' });
    expect(push.sendToTenant).toHaveBeenCalledWith('A', expect.objectContaining({ url: '/salon/staff?timeoff=1' }), expect.anything());
    await expect(svc.request(kim, { startDate: '2026-10-21', endDate: '2026-10-22' }, NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.request(kim, { startDate: '2026-10-01', endDate: '2026-10-02' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const d: Row = await svc.decide(owner('A'), r.id, 'APPROVED', 'ok', NOW);
    expect(d.status).toBe('APPROVED');
    expect(rows[0].status).toBe('APPROVED');
    expect(push.sendToUser).toHaveBeenCalledWith('A', 'u-kim', expect.objectContaining({ title: 'Đã duyệt ngày nghỉ' }));
    expect(seen.every((t) => t === 'A')).toBe(true);
  });

  it('another salon\'s owner can neither see nor decide it', async () => {
    const { svc, rows } = make();
    const r: Row = await svc.request(kim, { startDate: '2026-10-20', endDate: '2026-10-21' }, NOW);
    expect((await svc.list(owner('B'), {}, NOW)).requests).toEqual([]);
    await expect(svc.decide(owner('B'), r.id, 'APPROVED', undefined, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove(owner('B'), r.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.create(owner('B'), { staffId: 'kim', startDate: '2026-10-25', endDate: '2026-10-25' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[0].status).toBe('PENDING');
    expect((await svc.list(owner('A'), {}, NOW)).pending).toBe(1);
  });

  it('she may withdraw a pending request or leave not yet started; the owner records leave directly as approved', async () => {
    const { svc, rows } = make([
      { id: 'past', tenantId: 'A', staffId: 'kim', startDate: '2026-10-07', endDate: '2026-10-09', status: 'APPROVED', startTime: null, endTime: null },
    ]);
    await expect(svc.cancel(kim, 'past', NOW)).rejects.toBeInstanceOf(BadRequestException);
    const r: Row = await svc.request(kim, { startDate: '2026-10-20', endDate: '2026-10-20', startTime: '13:00', endTime: '17:00' }, NOW);
    await svc.cancel(kim, r.id, NOW);
    expect(rows.find((x) => x.id === r.id)!.status).toBe('CANCELLED');
    const o: Row = await svc.create(owner('A'), { staffId: 'kim', startDate: '2026-10-01', endDate: '2026-10-01', reason: 'ốm' }, NOW);
    expect(o.status).toBe('APPROVED');
    await expect(svc.cancel({ userId: 'u-zoe', tenantId: 'B', role: 'STAFF' } as never, r.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
