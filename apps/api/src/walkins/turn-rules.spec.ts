/**
 * CHIA TUA: the salon's rules for who gets the next customer. The defaults
 * are the floor's old behaviour; each rule changes exactly one thing; a
 * seated booking is one turn, not two; corrections and rules are one salon's.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    AppointmentStatus: actual.AppointmentStatus ?? { COMPLETED: 'COMPLETED', ARRIVED: 'ARRIVED', PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED' },
  };
});
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalkinsService } from './walkins.service';
import { cleanTurnRules, DEFAULT_TURN_RULES, legTurns, appointmentTurns, tieCompare, minutesLate, latePenalty, toBottomDelta, isReverseLeg, newTechBoost } from './turn-rules';
import { lastDoneFromTickets, moneyFromTickets, pickTech, turnsFromTickets, TicketLike } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('rules', () => {
  it('defaults = the old floor; junk is cleaned', () => {
    expect(cleanTurnRules(null)).toEqual(DEFAULT_TURN_RULES);
    expect(cleanTurnRules({ mode: 'MONEY', tieBreak: 'LAST_FINISHED', requestWeight: 0.5, appointmentWeight: 'NONE', halfBelowCents: 2500.4 }))
      .toEqual({ ...DEFAULT_TURN_RULES, mode: 'MONEY', tieBreak: 'LAST_FINISHED', requestWeight: 0.5, appointmentWeight: 'NONE', halfBelowCents: 2500 });
    expect(cleanTurnRules({ breakPolicy: 'BOTTOM', skipPolicy: 'COUNT_AS_TURN', latePolicy: 'PLUS_HALF', lateGraceMin: 10 })).toMatchObject({ breakPolicy: 'BOTTOM', skipPolicy: 'COUNT_AS_TURN', latePolicy: 'PLUS_HALF', lateGraceMin: 10 });
    expect(cleanTurnRules({ mode: 'X', requestWeight: 3, halfBelowCents: -5 })).toEqual(DEFAULT_TURN_RULES);
    // Phase 3: the unwanted services, the new technician's head start, the owner out of the rotation.
    expect(cleanTurnRules({ reverseServiceIds: ['a', 'a', 7, ''], newTechDays: 30.4, newTechBoost: 1, ownerInRotation: false }))
      .toMatchObject({ reverseServiceIds: ['a'], newTechDays: 30, newTechBoost: 1, ownerInRotation: false });
    expect(cleanTurnRules({ newTechDays: -2, newTechBoost: 3, ownerInRotation: 'yes' })).toMatchObject({ newTechDays: 0, newTechBoost: 0.5, ownerInRotation: true });
  });
  it('tua ngược and the new technician\'s head start', () => {
    const r = { ...DEFAULT_TURN_RULES, reverseServiceIds: ['polish'], newTechDays: 14, newTechBoost: 1 as const };
    expect(isReverseLeg(['polish'], r)).toBe(true);
    expect(isReverseLeg(['polish', 'gel'], r)).toBe(false);
    expect(isReverseLeg([], r)).toBe(false);
    expect(isReverseLeg(['polish'], DEFAULT_TURN_RULES)).toBe(false);
    const now = new Date('2026-10-09T12:00:00Z');
    expect(newTechBoost(new Date('2026-10-01T12:00:00Z'), now, r)).toBe(-1);
    expect(newTechBoost(new Date('2026-09-01T12:00:00Z'), now, r)).toBe(0);
    expect(newTechBoost(new Date('2026-10-01T12:00:00Z'), now, DEFAULT_TURN_RULES)).toBe(0);
    expect(newTechBoost(null, now, r)).toBe(0);
    // The pick: the polish change goes to whoever is furthest ahead; the owner out of the rotation is never auto-picked.
    const techs = [{ id: 'kim', name: 'kim', priority: 0, skills: [] }, { id: 'lisa', name: 'lisa', priority: 0, skills: [] }];
    const turns = new Map([['kim', 3], ['lisa', 1]]);
    expect(pickTech(techs, ['gel'], turns, { rules: r })?.id).toBe('lisa');
    expect(pickTech(techs, ['polish'], turns, { rules: r })?.id).toBe('kim');
    expect(pickTech(techs, ['gel'], turns, { rules: r, manualOnly: new Set(['lisa']) })?.id).toBe('kim');
    expect(pickTech(techs, ['gel'], turns, { rules: r, manualOnly: new Set(['kim', 'lisa']) })).toBeNull();
  });
  it('what a leg and a booking are worth', () => {
    expect(legTurns({ turnValue: 1 })).toBe(1);
    expect(legTurns({ turnValue: 1, pinned: true }, { ...DEFAULT_TURN_RULES, requestWeight: 0.5 })).toBe(0.5);
    expect(legTurns({ turnValue: 1, pinned: true }, { ...DEFAULT_TURN_RULES, requestWeight: 0 })).toBe(0);
    expect(legTurns({ turnValue: 1, priceCents: 1500 }, { ...DEFAULT_TURN_RULES, mode: 'HYBRID', halfBelowCents: 2500 })).toBe(0.5);
    expect(legTurns({ turnValue: 1, priceCents: 4500 }, { ...DEFAULT_TURN_RULES, mode: 'HYBRID', halfBelowCents: 2500 })).toBe(1);
    expect(legTurns({ turnValue: 0, priceCents: 500 }, { ...DEFAULT_TURN_RULES, mode: 'HYBRID', halfBelowCents: 2500 })).toBe(0);
    expect(appointmentTurns(0.5)).toBe(1);
    expect(appointmentTurns(0.5, { ...DEFAULT_TURN_RULES, appointmentWeight: 'BY_SERVICE' })).toBe(0.5);
    expect(appointmentTurns(1, { ...DEFAULT_TURN_RULES, appointmentWeight: 'NONE' })).toBe(0);
  });
  it('late to the schedule, and the way to the end of the line', () => {
    const day = Date.parse('2026-10-09T00:00:00Z');
    expect(minutesLate(day + 9 * 3600_000, day, '09:00', 15)).toBe(0);           // on time
    expect(minutesLate(day + 9.5 * 3600_000, day, '09:00', 15)).toBe(15);        // 30 late, 15 grace
    expect(minutesLate(day + 10 * 3600_000, day, null, 15)).toBe(0);             // no schedule → never late
    expect(latePenalty({ ...DEFAULT_TURN_RULES, latePolicy: 'PLUS_ONE' }, 15)).toBe(1);
    expect(latePenalty({ ...DEFAULT_TURN_RULES, latePolicy: 'PLUS_HALF' }, 15)).toBe(0.5);
    expect(latePenalty(DEFAULT_TURN_RULES, 15)).toBe(0);
    expect(toBottomDelta(1, [3, 2])).toBe(2);
    expect(toBottomDelta(3, [3, 2])).toBe(0);
    expect(toBottomDelta(0, [])).toBe(0);
  });
  it('tie-breaks: free longest, or in first, then priority', () => {
    const a = { id: 'a', priority: 0 }, b = { id: 'b', priority: 5 };
    expect(tieCompare(a, b, DEFAULT_TURN_RULES)).toBeGreaterThan(0); // b's priority wins
    const lf = { ...DEFAULT_TURN_RULES, tieBreak: 'LAST_FINISHED' as const };
    expect(tieCompare(a, b, lf, { lastDone: new Map([['a', 100], ['b', 500]]) })).toBeLessThan(0); // a finished earlier → a first
    expect(tieCompare(a, b, lf, { lastDone: new Map([['b', 500]]) })).toBeLessThan(0);              // a never finished → a first
    const ci = { ...DEFAULT_TURN_RULES, tieBreak: 'CLOCK_IN' as const };
    expect(tieCompare(a, b, ci, { clockIn: new Map([['a', 900], ['b', 800]]) })).toBeGreaterThan(0); // b came in first
    expect(tieCompare(a, b, ci, { clockIn: new Map([['a', 900]]) })).toBeLessThan(0);                // b never clocked in → last
  });
});

const line = (lineId: string, serviceId: string, priceCents: number, legId: string, staffId: string, extra: Row = {}) =>
  ({ lineId, serviceId, name: serviceId, priceCents, staffId, legId, zone: 'HAND', legStatus: 'DONE', doneAt: '2026-10-09T18:00:00Z', turnValue: 1, ...extra });
const done = (id: string, items: Row[], doneAt = '2026-10-09T18:00:00Z'): TicketLike => ({ id, status: 'DONE', assignedStaffId: null, createdAt: '2026-10-09T16:00:00Z', doneAt, items });
const SINCE = new Date('2026-10-09T13:00:00Z');

describe('turns, money and the pick under each rule', () => {
  const tickets = [
    done('t1', [line('l1', 'full-set', 6000, 'L1', 'kim')]),
    done('t2', [line('l2', 'polish', 1500, 'L2', 'lisa', { pinned: true, doneAt: '2026-10-09T19:00:00Z' })], '2026-10-09T19:00:00Z'),
  ];
  it('COUNT (default): one turn each; HYBRID halves the small one; requestWeight shrinks the requested one', () => {
    expect([...turnsFromTickets(tickets, SINCE)]).toEqual([['kim', 1], ['lisa', 1]]);
    expect(turnsFromTickets(tickets, SINCE, { ...DEFAULT_TURN_RULES, mode: 'HYBRID', halfBelowCents: 2500 }).get('lisa')).toBe(0.5);
    expect(turnsFromTickets(tickets, SINCE, { ...DEFAULT_TURN_RULES, requestWeight: 0 }).get('lisa')).toBeUndefined();
    expect([...moneyFromTickets(tickets, SINCE)]).toEqual([['kim', 6000], ['lisa', 1500]]);
    expect(lastDoneFromTickets(tickets, SINCE).get('lisa')).toBe(Date.parse('2026-10-09T19:00:00Z'));
  });
  it('MONEY: the one who made less goes first even with equal turns; LAST_FINISHED: the one free longest', () => {
    const team = [{ id: 'kim', name: 'Kim', priority: 0, skills: [] }, { id: 'lisa', name: 'Lisa', priority: 0, skills: [] }];
    const turns = turnsFromTickets(tickets, SINCE);
    expect(pickTech(team, [], turns)?.id).toBe('kim'); // equal turns → list order
    expect(pickTech(team, [], turns, { rules: { ...DEFAULT_TURN_RULES, mode: 'MONEY' }, money: moneyFromTickets(tickets, SINCE) })?.id).toBe('lisa');
    expect(pickTech(team, [], turns, { rules: { ...DEFAULT_TURN_RULES, tieBreak: 'LAST_FINISHED' }, facts: { lastDone: lastDoneFromTickets(tickets, SINCE) } })?.id).toBe('kim');
    expect(pickTech(team, [], turns, { rules: { ...DEFAULT_TURN_RULES, tieBreak: 'CLOCK_IN' }, facts: { clockIn: new Map([['lisa', 1], ['kim', 2]]) } })?.id).toBe('lisa');
  });
});

describe('the floor applies the salon\'s rules — one salon at a time', () => {
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, cond]) => {
      const v = row[k];
      if (k === 'tenantId_key') return row.tenantId === cond.tenantId && row.key === cond.key;
      if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
        if ('in' in cond) return (cond.in as unknown[]).includes(v);
        if ('gte' in cond) return v != null && v >= cond.gte;
        if ('not' in cond) return v !== cond.not;
        return true;
      }
      return v === cond;
    });
  }
  const table = (rows: Row[]) => ({
    rows,
    findMany: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: Row) => { const r = { id: `r${rows.length + 1}`, createdAt: new Date(), ...data }; rows.push(r); return r; },
    deleteMany: async ({ where }: Row) => { const n = rows.filter((r) => matches(r, where)).length; return { count: n }; },
    upsert: async ({ where, create }: Row) => { const i = rows.findIndex((r) => matches(r, where)); if (i >= 0) rows[i].value = create.value; else rows.push({ ...create }); return create; },
    groupBy: async () => [],
  });
  const tech = (id: string, tenantId = 'A') => ({ id, tenantId, firstName: id, lastName: null, avatarUrl: null, bookingPriority: 0, isActive: true, takesAppointments: true, userId: `u-${id}` });
  function make(o: { rules?: Row; walkIns?: Row[]; appts?: Row[]; adjustments?: Row[] } = {}) {
    const now = new Date();
    const prisma = {
      tenant: table([{ id: 'A', timezone: 'UTC' }, { id: 'B', timezone: 'UTC' }]),
      setting: table(o.rules ? [{ tenantId: 'A', key: 'turn_rules', value: o.rules }] : []),
      staffMember: table([tech('kim'), tech('lisa'), tech('zoe', 'B')]),
      staffService: table([]),
      walkIn: table((o.walkIns ?? []).map((r) => ({ tenantId: 'A', assignedStaffId: null, assignedAt: null, doneAt: now, awaitingPayment: false, stationId: null, items: [], createdAt: now, ...r }))),
      service: table([]),
      appointment: table(o.appts ?? []),
      turnAdjustment: table(o.adjustments ?? []),
      timeEntry: table([]),
      order: table([]), tipLog: table([]), station: table([]),
    };
    const audit = { log: jest.fn() };
    const svc = new WalkinsService(prisma as never, {} as never, { getBookingRules: async () => ({ currency: 'USD' }) } as never, undefined, audit as never);
    return { svc, prisma, audit };
  }
  const admin = { userId: 'own', tenantId: 'A', role: 'SALON_ADMIN' } as never;
  const adminB = { userId: 'own-b', tenantId: 'B', role: 'SALON_ADMIN' } as never;
  const legItem = (staffId: string, price = 3000, extra: Row = {}) => ({ lineId: `l-${staffId}`, serviceId: 'svc', name: 'Gel', priceCents: price, staffId, legId: `L-${staffId}`, zone: 'HAND', legStatus: 'DONE', doneAt: new Date().toISOString(), turnValue: 1, ...extra });

  it('a break takes her out of the rotation; back from it under BOTTOM she goes to the end; a skipped leg never returns to her and costs what the rule says', async () => {
    const { svc, prisma } = make({
      rules: { breakPolicy: 'BOTTOM', skipPolicy: 'COUNT_AS_TURN' },
      walkIns: [
        { id: 'w1', status: 'DONE', customerName: 'Mai', items: [legItem('lisa')] },
        { id: 'w2', status: 'DONE', customerName: 'Ann', items: [legItem('lisa', 3000, { lineId: 'l-lisa-2', legId: 'L-lisa-2' })] },
        { id: 'w3', status: 'SERVING', customerName: 'Zed', assignedStaffId: 'kim', items: [legItem('kim', 4000, { legStatus: 'SERVING', doneAt: null, startedAt: new Date().toISOString() })] },
      ],
    });
    // Kim on a break: she is not in the running order.
    await svc.setBreak(admin, 'kim', true);
    let r: Row = await svc.turnsToday(admin);
    expect(r.techs.find((t: Row) => t.id === 'kim')).toMatchObject({ onBreak: true, rank: null });
    // Back: lisa has 2 turns, kim 0 → a +2 correction puts kim at the end.
    await svc.setBreak(admin, 'kim', false);
    r = await svc.turnsToday(admin);
    expect(r.techs.find((t: Row) => t.id === 'kim')).toMatchObject({ onBreak: false, turns: 2, fromAdjustments: 2 });
    expect(prisma.turnAdjustment.rows[0].reason).toMatch(/xuống cuối/);
    // Kim passes Zed on: the leg is back in the queue, never for kim; COUNT_AS_TURN charges her the turn.
    (svc as unknown as Row).writeItems = async (t: Row, items: Row[]) => { prisma.walkIn.rows.find((x: Row) => x.id === t.id).items = items; };
    (svc as unknown as Row).mine = async (_u: unknown, id: string) => prisma.walkIn.rows.find((x: Row) => x.id === id);
    (svc as unknown as Row).legItems = async (_t: string, t: Row, legId: string) => ({ items: t.items, legId });
    (svc as unknown as Row).row = async () => ({ ok: true });
    await svc.skipLeg(admin, 'w3', 'L-kim', 'không làm chân');
    const w3 = prisma.walkIn.rows.find((x: Row) => x.id === 'w3');
    // The dispatcher handed Zed straight to lisa (free, not on the skipped list) — never back to kim.
    expect(w3.items[0]).toMatchObject({ staffId: 'lisa', legStatus: 'SERVING', skippedBy: ['kim'] });
    expect(prisma.turnAdjustment.rows.some((a: Row) => a.staffId === 'kim' && a.delta === 1 && /Bỏ qua khách/.test(a.reason))).toBe(true);
    // Another salon's owner cannot put kim on a break.
    await expect(svc.setBreak(adminB, 'kim', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the owner out of the rotation takes requested clients only; a new technician starts a turn behind', async () => {
    const waiting = (id: string, name: string, extra: Row = {}) => ({ id, status: 'WAITING', customerName: name, doneAt: null, items: [{ lineId: `l-${id}`, serviceId: 'svc', name: 'Gel', priceCents: 3000, staffId: null, legId: `L-${id}`, zone: 'HAND', legStatus: 'WAITING', turnValue: 1, ...extra }] });
    const { svc, prisma } = make({
      rules: { ownerInRotation: false, newTechDays: 30, newTechBoost: 1 },
      walkIns: [waiting('w1', 'Mai', { staffId: 'kim', pinned: true }), waiting('w2', 'Ann')],
    });
    // kim is the owner (her login is the salon admin) with a higher priority; lisa started last week.
    const kim = prisma.staffMember.rows.find((r: Row) => r.id === 'kim'); kim.user = { role: 'SALON_ADMIN' }; kim.bookingPriority = 5; kim.createdAt = new Date('2024-01-01');
    const lisa = prisma.staffMember.rows.find((r: Row) => r.id === 'lisa'); lisa.createdAt = new Date(Date.now() - 7 * 86400000);
    const r: Row = await svc.turnsToday(admin);
    expect(r.techs.find((t: Row) => t.id === 'kim')).toMatchObject({ inRotation: false, rank: null, turns: 0 });
    expect(r.techs.find((t: Row) => t.id === 'lisa')).toMatchObject({ inRotation: true, rank: 1, turns: -1, fromBoost: -1 });
    expect(r.entries.find((e: Row) => e.kind === 'boost')).toMatchObject({ staffId: 'lisa', value: -1 });
    // Dispatch: Mai asked for kim → kim; Ann goes to lisa (kim would have won on priority inside the rotation).
    (svc as unknown as Row).writeItems = async (t: Row, items: Row[]) => { prisma.walkIn.rows.find((x: Row) => x.id === t.id).items = items; };
    await svc.seatWaitingQueue('A');
    expect(prisma.walkIn.rows.find((x: Row) => x.id === 'w1').items[0]).toMatchObject({ staffId: 'kim', legStatus: 'SERVING' });
    expect(prisma.walkIn.rows.find((x: Row) => x.id === 'w2').items[0]).toMatchObject({ staffId: 'lisa', legStatus: 'SERVING' });
    // The other salon sees none of it.
    const rb: Row = await svc.turnsToday(adminB);
    expect(rb.techs.map((t: Row) => t.id)).toEqual(['zoe']);
  });

  it('a booking seated on the floor is ONE turn, not a ticket turn plus a booking turn', async () => {
    const now = new Date();
    const { svc } = make({
      walkIns: [{ id: 'w1', status: 'DONE', appointmentId: 'b1', items: [legItem('kim')] }],
      appts: [{ id: 'b1', tenantId: 'A', status: 'COMPLETED', assignedStaffId: 'kim', completedAt: now, priceCents: 3000, customer: null, service: { name: 'Gel', turnValue: 1 } },
              { id: 'b2', tenantId: 'A', status: 'COMPLETED', assignedStaffId: 'lisa', completedAt: now, priceCents: 5000, customer: null, service: { name: 'Pedi', turnValue: 1 } }],
    });
    const r: Row = await svc.turnsToday(admin);
    expect(r.techs.find((t: Row) => t.id === 'kim')).toMatchObject({ turns: 1, fromLegs: 1, fromAppointments: 0 });
    expect(r.techs.find((t: Row) => t.id === 'lisa')).toMatchObject({ turns: 1, fromLegs: 0, fromAppointments: 1 });
    expect(r.techs.map((t: Row) => t.id)).not.toContain('zoe');
  });

  it('rules change the count; a correction counts and is logged; another salon cannot touch it', async () => {
    const { svc, audit } = make({
      rules: { requestWeight: 0.5, tieBreak: 'LAST_FINISHED' },
      walkIns: [{ id: 'w1', status: 'DONE', customerName: 'Mai', items: [legItem('kim', 3000, { pinned: true })] }, { id: 'w2', status: 'DONE', customerName: 'Ann', items: [legItem('lisa')] }],
    });
    let r: Row = await svc.turnsToday(admin);
    expect(r.rules.requestWeight).toBe(0.5);
    expect(r.techs.find((t: Row) => t.id === 'kim').turns).toBe(0.5);
    expect(r.entries.find((e: Row) => e.staffId === 'kim')).toMatchObject({ kind: 'leg', value: 0.5, pinned: true });
    await svc.adjustTurn(admin, { staffId: 'kim', delta: 1, reason: 'đi trễ' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'turn.adjusted' }));
    r = await svc.turnsToday(admin);
    expect(r.techs.find((t: Row) => t.id === 'kim')).toMatchObject({ turns: 1.5, fromAdjustments: 1 });
    await expect(svc.adjustTurn(adminB, { staffId: 'kim', delta: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.adjustTurn(admin, { staffId: 'kim', delta: 0 })).rejects.toBeInstanceOf(BadRequestException);
    // B's rules are B's: it reads defaults, not A's.
    expect(await svc.getTurnRules(adminB)).toEqual(DEFAULT_TURN_RULES);
    expect((await svc.updateTurnRules(adminB, { mode: 'MONEY' })).mode).toBe('MONEY');
    expect((await svc.getTurnRules(admin)).mode).toBe('COUNT');
  });
});
