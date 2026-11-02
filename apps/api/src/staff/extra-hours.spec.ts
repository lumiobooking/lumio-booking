/**
 * "Giữ chuột kéo khung giờ thợ off … giữ chuột kéo và cho mở lịch lại"
 * (2 Nov 2026): a drag over a technician's column blocks the hours she works,
 * or opens hours she is off — and every place that books her agrees.
 */
import { cutBlock, intersect, shiftSpans, subtract, union, withExtraHours } from './extra-hours';
import { TimeOffService } from './time-off.service';
import { PartyAvailabilityService } from '../bookings/party-availability.service';
import { isWithinWorkingHours } from '../assignment/assignment.util';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Monday 9 Nov 2026 (dow 1).
const MON = '2026-11-09';
const kimWeek = [
  { dayOfWeek: 1, startTime: '10:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 2, startTime: '10:00', endTime: '18:00', isActive: true },
];

describe('the time arithmetic', () => {
  it('joins, cuts and overlaps spans', () => {
    expect(union([{ s: 60, e: 120 }, { s: 120, e: 180 }, { s: 10, e: 20 }])).toEqual([{ s: 10, e: 20 }, { s: 60, e: 180 }]);
    expect(subtract([{ s: 600, e: 1080 }], [{ s: 720, e: 780 }])).toEqual([{ s: 600, e: 720 }, { s: 780, e: 1080 }]);
    expect(intersect([{ s: 900, e: 1200 }], [{ s: 600, e: 1080 }])).toEqual([{ s: 900, e: 1080 }]);
  });

  it('extra hours join her shift that day only — and never narrow a technician with no schedule', () => {
    const extra = [{ staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00' }, { staffId: 'lily', day: MON, startTime: '07:00', endTime: '09:00' }];
    expect(shiftSpans(kimWeek, extra, 'kim', MON)).toEqual([{ s: 600, e: 1200 }]);
    expect(shiftSpans(kimWeek, extra, 'kim', '2026-11-10')).toEqual([{ s: 600, e: 1080 }]);
    expect(withExtraHours([], extra, 'kim', MON)).toEqual([]);
    // a day she is normally off (Sunday 8 Nov) opened 12–16
    expect(shiftSpans(kimWeek, [{ staffId: 'kim', day: '2026-11-08', startTime: '12:00', endTime: '16:00' }], 'kim', '2026-11-08')).toEqual([{ s: 720, e: 960 }]);
  });

  it('the assignment engine sees a booking running into the extra hours as on shift', () => {
    const slot = { dayOfWeek: 1, startMinutes: 17 * 60, endMinutes: 19 * 60 } as never;
    expect(isWithinWorkingHours(slot, kimWeek)).toBe(false);
    expect(isWithinWorkingHours(slot, withExtraHours(kimWeek, [{ staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00' }], 'kim', MON) as never)).toBe(true);
  });

  it('opening part of a block keeps the rest of it', () => {
    expect(cutBlock({ startDate: MON, endDate: MON, startTime: '12:00', endTime: '16:00' }, MON, 13 * 60, 14 * 60)).toEqual([
      { startDate: MON, endDate: MON, startTime: '12:00', endTime: '13:00' },
      { startDate: MON, endDate: MON, startTime: '14:00', endTime: '16:00' },
    ]);
    expect(cutBlock({ startDate: '2026-11-08', endDate: '2026-11-10', startTime: null, endTime: null }, MON, 0, 24 * 60)).toEqual([
      { startDate: '2026-11-08', endDate: '2026-11-08', startTime: null, endTime: null },
      { startDate: '2026-11-10', endDate: '2026-11-10', startTime: null, endTime: null },
    ]);
    expect(cutBlock({ startDate: MON, endDate: MON, startTime: '12:00', endTime: '16:00' }, MON, 11 * 60, 17 * 60)).toEqual([]);
  });
});

// ---- the drag, against a fake database -------------------------------------

function world() {
  const db: Record<string, Row[]> = {
    staffMember: [
      { id: 'kim', tenantId: 't1', firstName: 'Kim', workingHours: kimWeek },
      { id: 'zoe', tenantId: 't2', firstName: 'Zoe', workingHours: kimWeek },
    ],
    timeOffRequest: [],
    staffExtraHours: [],
    tenant: [{ id: 't1', timezone: 'America/Chicago' }, { id: 't2', timezone: 'America/Chicago' }],
    appointment: [],
  };
  const seen: { model: string; where: Row }[] = [];
  const match = (r: Row, w: Row = {}): boolean => Object.entries(w).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((x) => match(r, x));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Row;
      if ('in' in o) return (o.in as unknown[]).includes(r[k]);
      if ('lte' in o && !(r[k] <= o.lte)) return false;
      if ('gte' in o && !(r[k] >= o.gte)) return false;
      if ('not' in o) return r[k] !== o.not;
      return true;
    }
    return r[k] === v;
  });
  let n = 0;
  const model = (name: string) => ({
    findFirst: async (a: Row) => { seen.push({ model: name, where: a.where }); return db[name].find((r) => match(r, a.where)) ?? null; },
    findUnique: async (a: Row) => db[name].find((r) => match(r, a.where)) ?? null,
    findMany: async (a: Row = {}) => { seen.push({ model: name, where: a.where ?? {} }); return db[name].filter((r) => match(r, a.where)); },
    create: async (a: Row) => { const r = { id: `${name}-${++n}`, ...a.data }; db[name].push(r); return r; },
    deleteMany: async (a: Row) => { seen.push({ model: name, where: a.where }); const before = db[name].length; db[name] = db[name].filter((r) => !match(r, a.where)); return { count: before - db[name].length }; },
    count: async () => 0,
  });
  const prisma: Row = {};
  for (const k of Object.keys(db)) prisma[k] = model(k);
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  const logs: Row[] = [];
  const svc = new TimeOffService(prisma as never, { log: async (e: Row) => { logs.push(e); } } as never, { sendToUser: async () => undefined } as never);
  return { svc, db, seen, logs, prisma };
}

const desk = { userId: 'u1', role: 'SALON_ADMIN', tenantId: 't1' } as never;
const NOW = new Date('2026-11-02T15:00:00Z');

describe('a drag on the Calendar', () => {
  it('over hours she works: they are blocked — nothing outside her shift is blocked', async () => {
    const { svc, db, logs } = world();
    const r = await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '16:00', endTime: '19:00', action: 'close' }, NOW);
    expect(r).toMatchObject({ action: 'close', blocked: 1 });
    expect(db.timeOffRequest).toEqual([expect.objectContaining({ tenantId: 't1', staffId: 'kim', startDate: MON, endDate: MON, startTime: '16:00', endTime: '18:00', status: 'APPROVED', requestedByUserId: 'u1', decidedByUserId: 'u1' })]);
    expect(logs[0]).toMatchObject({ tenantId: 't1', userId: 'u1', action: 'calendar.range_closed' });
  });

  it('dragging again over a blocked time adds nothing', async () => {
    const { svc, db } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '16:00', endTime: '18:00', action: 'close' }, NOW);
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '15:00', endTime: '18:00', action: 'close' }, NOW);
    expect(db.timeOffRequest.map((b) => `${b.startTime}-${b.endTime}`).sort()).toEqual(['15:00-16:00', '16:00-18:00']);
  });

  it('opening part of a block the desk made cuts it back', async () => {
    const { svc, db } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '12:00', endTime: '16:00', action: 'close' }, NOW);
    const r = await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '13:00', endTime: '14:00', action: 'open' }, NOW);
    expect(r).toMatchObject({ action: 'open', unblocked: 1, extraHours: 0 });
    expect(db.timeOffRequest.map((b) => `${b.startTime}-${b.endTime}`).sort()).toEqual(['12:00-13:00', '14:00-16:00']);
  });

  it('opening hours outside her schedule makes extra hours for that day — joined with ones already there', async () => {
    const { svc, db } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '18:00', endTime: '19:00', action: 'open' }, NOW);
    const r = await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '17:00', endTime: '20:00', action: 'open' }, NOW);
    expect(r).toMatchObject({ extraHours: 1 });
    expect(db.staffExtraHours).toEqual([expect.objectContaining({ tenantId: 't1', staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00', createdByUserId: 'u1' })]);
    // and blocking part of it again takes the extra hours back
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '19:00', endTime: '20:00', action: 'close' }, NOW);
    expect(db.staffExtraHours.map((x) => `${x.startTime}-${x.endTime}`)).toEqual(['18:00-19:00']);
    expect(db.timeOffRequest).toHaveLength(0);
  });

  it('a day she is normally off can be opened', async () => {
    const { svc, db } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: '2026-11-08', startTime: '12:00', endTime: '16:00', action: 'open' }, NOW);
    expect(db.staffExtraHours).toEqual([expect.objectContaining({ day: '2026-11-08', startTime: '12:00', endTime: '16:00' })]);
  });

  it('leave the technician asked for, and a whole-salon block, are not opened from a column', async () => {
    const { svc, db } = world();
    db.timeOffRequest.push(
      { id: 'leave', tenantId: 't1', staffId: 'kim', startDate: MON, endDate: MON, startTime: null, endTime: null, status: 'APPROVED', requestedByUserId: 'kim-user', decidedByUserId: 'owner' },
      { id: 'salon', tenantId: 't1', staffId: null, startDate: MON, endDate: MON, startTime: '12:00', endTime: '13:00', status: 'APPROVED', requestedByUserId: 'owner', decidedByUserId: 'owner' },
    );
    const r = await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '11:00', endTime: '14:00', action: 'open' }, NOW);
    expect(r).toMatchObject({ unblocked: 0, leaveKept: true, salonKept: true });
    expect(db.timeOffRequest.map((b) => b.id).sort()).toEqual(['leave', 'salon']);
  });

  it('another salon’s technician, a past day, a backwards range: refused', async () => {
    const { svc, db } = world();
    await expect(svc.rangeAction(desk, { staffId: 'zoe', day: MON, startTime: '10:00', endTime: '12:00', action: 'close' }, NOW)).rejects.toThrow(/not found/);
    await expect(svc.rangeAction(desk, { staffId: 'kim', day: '2026-11-01', startTime: '10:00', endTime: '12:00', action: 'close' }, NOW)).rejects.toThrow(/passed/);
    await expect(svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '12:00', endTime: '10:00', action: 'open' }, NOW)).rejects.toThrow(/after the start/);
    expect(db.timeOffRequest).toHaveLength(0);
    expect(db.staffExtraHours).toHaveLength(0);
  });

  it('every read and write is the salon’s own', async () => {
    const { svc, seen } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '12:00', endTime: '16:00', action: 'close' }, NOW);
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '17:00', endTime: '20:00', action: 'open' }, NOW);
    for (const q of seen) expect(q.where.tenantId).toBe('t1');
  });

  it('the Calendar reads the extra hours with the blocks', async () => {
    const { svc } = world();
    await svc.rangeAction(desk, { staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00', action: 'open' }, NOW);
    const r = await svc.calendarBlocks(desk, { from: MON, to: MON }, NOW);
    expect(r.open).toEqual([expect.objectContaining({ staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00' })]);
  });
});

describe('the booking engines read the extra hours', () => {
  it('chat bot / hotline / booking page: the extra hours are free, outside them she is still off', async () => {
    const prisma = {
      staffMember: { findMany: async () => [{ id: 'kim', firstName: 'Kim', staffServices: [], workingHours: kimWeek }] },
      appointment: { findMany: async () => [] },
      timeOffRequest: { findMany: async () => [] },
      staffExtraHours: { findMany: async (a: Row) => (a.where.tenantId === 't1' ? [{ staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00' }] : []) },
    };
    const pa = new PartyAvailabilityService(prisma as never, { getBookingRules: async () => ({}) } as never);
    const tz = 'America/Chicago';
    const day = await pa.staffDay('t1', MON, tz);
    const busy = day.techs[0].busy.map((b) => [b.start.toISOString(), b.end.toISOString()]);
    // CST is UTC-6: 18:00–20:00 local = 00:00–02:00Z next day — not busy; 20:00 on is.
    expect(busy.some(([s, e]) => s < '2026-11-10T02:00:00.000Z' && e > '2026-11-10T00:00:00.000Z')).toBe(false);
    expect(busy.some(([s, e]) => s <= '2026-11-10T02:00:00.000Z' && e > '2026-11-10T02:00:00.000Z')).toBe(true);
    // another salon reading the same day gets none of these extra hours
    const other = await pa.staffDay('t2', MON, tz);
    expect(other.techs[0].busy.some((b) => b.start.toISOString() <= '2026-11-10T00:00:00.000Z' && b.end.toISOString() >= '2026-11-10T02:00:00.000Z')).toBe(true);
  });
});
