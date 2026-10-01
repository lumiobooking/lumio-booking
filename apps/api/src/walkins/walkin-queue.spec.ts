import { NotFoundException } from '@nestjs/common';

// A locally built Prisma client can predate the WalkInStatus enum; the values
// are plain strings either way.
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { LegItem, legsOf, phaseOf, TicketLike } from './walkin-legs';

/**
 * The walk-in floor end to end, on an in-memory database: the queue goes in
 * arrival order, a customer's hands and feet go to two technicians, a
 * customer between two legs is served before newcomers, the desk can move a
 * leg mid-service, and one salon never touches another's tickets.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('gte' in cond) return v != null && v >= cond.gte && (!('lt' in cond) || v < cond.lt);
      if ('not' in cond) return v !== cond.not;
      return true;
    }
    return v === cond;
  });
}

function table(rows: Row[]) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where))),
    findFirst: jest.fn(async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null),
    count: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length),
    groupBy: jest.fn(async () => []),
    create: jest.fn(async ({ data }: Row) => { const r = { id: `w${rows.length + 1}`, createdAt: new Date(), items: [], ...data }; rows.push(r); return r; }),
    update: jest.fn(async ({ where, data }: Row) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; }),
    updateMany: jest.fn(async ({ where, data }: Row) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
  };
}

const T1 = 't1';
const at = (min: number) => new Date(Date.now() - (120 - min) * 60000);
const tech = (id: string, tenantId = T1) => ({ id, tenantId, firstName: id, lastName: null, avatarUrl: null, bookingPriority: 0, isActive: true, takesAppointments: true, userId: `u-${id}` });
const MENU = [
  { id: 'mani', tenantId: T1, name: 'Gel Manicure', priceCents: 3500, discountPercent: 0, durationMinutes: 40, turnValue: 1, category: { name: 'Hands' } },
  { id: 'pedi', tenantId: T1, name: 'Spa Pedicure', priceCents: 4500, discountPercent: 0, durationMinutes: 50, turnValue: 1, category: { name: 'Feet' } },
  { id: 'art', tenantId: T1, name: 'Nail Art', priceCents: 1000, discountPercent: 0, durationMinutes: 10, turnValue: 0.5, category: null },
];
const legacyLine = (lineId: string, serviceId: string, name: string, staffId: string | null = null): LegItem =>
  ({ lineId, serviceId, name, priceCents: 1000, durationMinutes: 30, staffId });

function floor(opts: { walkIns?: Row[]; staff?: Row[]; links?: Row[] } = {}) {
  const prisma = {
    tenant: table([{ id: T1, timezone: 'America/Los_Angeles' }, { id: 't2', timezone: 'America/Los_Angeles' }]),
    staffMember: table(opts.staff ?? [tech('hana'), tech('lisa')]),
    staffService: table(opts.links ?? []),
    walkIn: table((opts.walkIns ?? []).map((r) => ({ tenantId: T1, assignedStaffId: null, assignedAt: null, doneAt: null, awaitingPayment: false, stationId: null, items: [], service: null, ...r }))),
    service: table(MENU),
    station: table([]),
    appointment: table([]),
    order: table([]),
  };
  const svc = new WalkinsService(prisma as never, {} as never, {} as never);
  const get = (id: string) => prisma.walkIn.rows.find((r) => r.id === id)!;
  const legs = (id: string) => legsOf(get(id) as unknown as TicketLike);
  return { prisma, svc, get, legs };
}
const admin = { userId: 'u-admin', tenantId: T1, role: 'SALON_ADMIN' } as never;
const asTech = (id: string) => ({ userId: `u-${id}`, tenantId: T1, role: 'STAFF' } as never);
const waiting = (id: string, min: number, extra: Row = {}): Row => ({ id, status: 'WAITING', createdAt: at(min), ...extra });

describe('the walk-in queue goes in order', () => {
  it('gives the free chair to whoever has waited longest, not the newest ticket', async () => {
    const f = floor({ walkIns: [waiting('first', 0), waiting('second', 5), waiting('third', 9)], staff: [tech('hana')] });
    expect(await f.svc.seatWaitingQueue(T1)).toEqual(['first']);
    expect(f.get('second').status).toBe('WAITING');
  });

  it('seats one customer per free technician and no more', async () => {
    const f = floor({ walkIns: [waiting('a', 0), waiting('b', 1), waiting('c', 2)] });
    expect(await f.svc.seatWaitingQueue(T1)).toEqual(['a', 'b']);
    expect(f.get('c').status).toBe('WAITING');
  });

  it('does nothing when every technician is busy', async () => {
    const f = floor({ walkIns: [{ id: 'busy', status: 'SERVING', assignedStaffId: 'hana', createdAt: at(0) }, waiting('a', 1)], staff: [tech('hana')] });
    expect(await f.svc.seatWaitingQueue(T1)).toEqual([]);
    expect(f.get('a').status).toBe('WAITING');
  });

  it('does nothing when nobody is waiting', async () => {
    const f = floor({ staff: [tech('hana')] });
    expect(await f.svc.seatWaitingQueue(T1)).toEqual([]);
  });

  it('a phone check-in behind a queue does not jump it', async () => {
    const f = floor({ walkIns: [waiting('early', 0), waiting('justNow', 8)], staff: [tech('hana')] });
    expect(await f.svc.seatSelfCheckIn(T1, 'justNow')).toBeNull();
    expect(f.get('justNow').status).toBe('WAITING');
    expect(f.get('early').status).toBe('SERVING');
  });

  it('a phone check-in with nobody ahead still lands on a tech straight away', async () => {
    const f = floor({ walkIns: [waiting('only', 0)], staff: [tech('hana')] });
    expect(await f.svc.seatSelfCheckIn(T1, 'only')).toBe('hana');
  });

  it('two presses at once never seat one customer on two technicians', async () => {
    const f = floor({ walkIns: [waiting('a', 0)] });
    const [x, y] = await Promise.all([f.svc.seatWaitingQueue(T1), f.svc.seatWaitingQueue(T1)]);
    expect([...x, ...y]).toEqual(['a']);
  });
});

describe('hands and feet', () => {
  it('a manicure + pedicure from the desk starts on two technicians at once', async () => {
    const f = floor();
    const w = await f.svc.add(admin, { customerName: 'Mai', serviceIds: ['mani', 'pedi'], autoAssign: true });
    const legs = f.legs(w.id);
    expect(legs.map((l) => [l.zone, l.status])).toEqual([['HAND', 'SERVING'], ['FOOT', 'SERVING']]);
    expect(new Set(legs.map((l) => l.staffId))).toEqual(new Set(['hana', 'lisa']));
    expect(f.get(w.id).status).toBe('SERVING');
  });

  it('a self check-in ticket (old-style lines) is split into hands and feet by the dispatcher', async () => {
    const f = floor({ walkIns: [waiting('kiosk', 0, { items: [legacyLine('a', 'mani', 'Gel Manicure'), legacyLine('b', 'pedi', 'Spa Pedicure')] })] });
    await f.svc.seatWaitingQueue(T1);
    expect(f.legs('kiosk').map((l) => l.zone)).toEqual(['HAND', 'FOOT']);
    expect(f.legs('kiosk').every((l) => l.status === 'SERVING')).toBe(true);
  });

  it('hands done, nobody free for the feet: the customer waits between legs, then goes first', async () => {
    // Only Hana does both; Lisa is busy with someone else.
    const f = floor({ walkIns: [{ id: 'other', status: 'SERVING', assignedStaffId: 'lisa', createdAt: at(0) }] });
    const w = await f.svc.add(admin, { serviceIds: ['mani', 'pedi'], autoAssign: true });
    expect(f.legs(w.id).map((l) => l.status)).toEqual(['SERVING', 'WAITING']);
    // A newcomer arrives while the hands are being done.
    const late = await f.svc.add(admin, { serviceIds: ['pedi'], autoAssign: true });
    expect(f.get(late.id).status).toBe('WAITING');
    // Hana finishes the hands: she is free, and the feet are next — before the newcomer.
    const hand = f.legs(w.id)[0];
    await f.svc.doneLeg(admin, w.id, hand.legId);
    const foot = f.legs(w.id)[1];
    expect(foot).toMatchObject({ status: 'SERVING', staffId: 'hana' });
    expect(f.get(late.id).status).toBe('WAITING');
    expect(f.get(w.id).status).toBe('SERVING');
    // Feet done → the visit is done and goes to the till.
    await f.svc.doneLeg(admin, w.id, foot.legId);
    expect(f.get(w.id).status).toBe('DONE');
    expect(f.get(late.id).status).toBe('SERVING'); // Hana takes the newcomer
  });

  it('shows "between legs" while nobody can take the next leg', async () => {
    const f = floor({ staff: [tech('hana')], links: [{ tenantId: T1, staffMemberId: 'hana', serviceId: 'mani' }] });
    // Hana only does hands.
    const w = await f.svc.add(admin, { serviceIds: ['mani', 'pedi'], autoAssign: true });
    await f.svc.doneLeg(admin, w.id, f.legs(w.id)[0].legId);
    // Nobody on the team is ticked for pedicures → the feet are open to anyone.
    expect(f.legs(w.id)[1].status).toBe('SERVING');
    // …but with a pedicurist on the books who is busy, the feet wait for her.
    const g = floor({
      staff: [tech('hana'), tech('lisa')],
      links: [{ tenantId: T1, staffMemberId: 'hana', serviceId: 'mani' }, { tenantId: T1, staffMemberId: 'lisa', serviceId: 'pedi' }],
      walkIns: [{ id: 'other', status: 'SERVING', assignedStaffId: 'lisa', createdAt: at(0) }],
    });
    const v = await g.svc.add(admin, { serviceIds: ['mani', 'pedi'], autoAssign: true });
    await g.svc.doneLeg(admin, v.id, g.legs(v.id)[0].legId);
    expect(g.legs(v.id)[1].status).toBe('WAITING');
    expect(phaseOf(g.get(v.id) as unknown as TicketLike)).toBe('BETWEEN');
    // Lisa finishes her other customer → she takes the feet.
    await g.svc.done(admin, 'other');
    expect(g.legs(v.id)[1]).toMatchObject({ status: 'SERVING', staffId: 'lisa' });
  });
});

describe('the desk can change anything, any time', () => {
  it('moves a leg to another technician mid-service; the turn follows', async () => {
    const f = floor({ staff: [tech('hana'), tech('vy')] });
    const w = await f.svc.add(admin, { serviceIds: ['mani'], assignedStaffId: 'hana' });
    const leg = f.legs(w.id)[0];
    expect(leg).toMatchObject({ status: 'SERVING', staffId: 'hana' });
    // Someone joins the queue ("add to waiting" only).
    const next = await f.svc.add(admin, { serviceIds: ['pedi'] });
    expect(f.get(next.id).status).toBe('WAITING');
    // The customer wants Vy instead of Hana.
    await f.svc.assignLeg(admin, w.id, leg.legId, 'vy');
    expect(f.legs(w.id)[0]).toMatchObject({ status: 'SERVING', staffId: 'vy', startedAt: leg.startedAt });
    expect(f.get(w.id).assignedStaffId).toBe('vy');
    // Hana is free again and takes whoever was waiting.
    expect(f.legs(next.id)[0]).toMatchObject({ status: 'SERVING', staffId: 'hana' });
  });

  it('a leg reserved for a busy technician waits for her; "start now" overrides', async () => {
    const f = floor({ walkIns: [{ id: 'other', status: 'SERVING', assignedStaffId: 'hana', createdAt: at(0) }] });
    const w = await f.svc.add(admin, { serviceIds: ['mani'], assignedStaffId: 'hana' });
    expect(f.legs(w.id)[0]).toMatchObject({ status: 'WAITING', staffId: 'hana', pinned: true });
    await f.svc.assignLeg(admin, w.id, f.legs(w.id)[0].legId, 'hana', true);
    expect(f.legs(w.id)[0].status).toBe('SERVING');
  });

  it('putting a leg back to "anyone" lets the dispatcher pick', async () => {
    const f = floor({ walkIns: [{ id: 'other', status: 'SERVING', assignedStaffId: 'hana', createdAt: at(0) }] });
    const w = await f.svc.add(admin, { serviceIds: ['mani'], assignedStaffId: 'hana' });
    await f.svc.assignLeg(admin, w.id, f.legs(w.id)[0].legId, null);
    expect(f.legs(w.id)[0]).toMatchObject({ status: 'SERVING', staffId: 'lisa' });
  });

  it('"Giao" on an old-style ticket still works', async () => {
    const f = floor({ walkIns: [waiting('old', 0, { items: [legacyLine('a', 'mani', 'Gel Manicure')] })] });
    await f.svc.assign(admin, 'old', 'lisa');
    expect(f.get('old')).toMatchObject({ status: 'SERVING', assignedStaffId: 'lisa' });
  });
});

describe('the technician’s own app', () => {
  it('"Xong" finishes only her leg; the feet stay for the next technician', async () => {
    const f = floor();
    const w = await f.svc.add(admin, { serviceIds: ['mani', 'pedi'], autoAssign: true });
    const handTech = f.legs(w.id)[0].staffId!;
    await f.svc.doneAsMe(asTech(handTech), w.id);
    expect(f.legs(w.id).map((l) => l.status)).toEqual(['DONE', 'SERVING']);
    expect(f.get(w.id).status).toBe('SERVING');
  });

  it('a service she logs while on the customer joins her leg', async () => {
    const f = floor();
    const w = await f.svc.add(admin, { serviceIds: ['mani'], assignedStaffId: 'hana' });
    await f.svc.addServiceAsMe(asTech('hana'), w.id, 'art');
    const legs = f.legs(w.id);
    expect(legs).toHaveLength(1);
    expect(legs[0].serviceIds).toEqual(['mani', 'art']);
  });

  it('an old-style ticket closes whole, as before', async () => {
    const f = floor({ walkIns: [{ id: 'old', status: 'SERVING', assignedStaffId: 'hana', createdAt: at(0), items: [legacyLine('a', 'mani', 'Gel Manicure', 'hana')] }] });
    await f.svc.doneAsMe(asTech('hana'), 'old');
    expect(f.get('old').status).toBe('DONE');
  });
});

describe('turns on the board', () => {
  it('counts each finished leg at its service’s turn value', async () => {
    const f = floor({ staff: [tech('hana')] });
    const w = await f.svc.add(admin, { serviceIds: ['mani', 'art'], assignedStaffId: 'hana' });
    await f.svc.done(admin, w.id);
    const board = await f.svc.board(admin);
    expect(board.staff.find((s) => s.id === 'hana')!.turns).toBe(1); // a leg is worth its biggest service
    const v = await f.svc.add(admin, { serviceIds: ['art'], assignedStaffId: 'hana' });
    await f.svc.done(admin, v.id);
    expect((await f.svc.board(admin)).staff.find((s) => s.id === 'hana')!.turns).toBe(1.5);
  });
});

describe('one salon never touches another', () => {
  it('cannot move or finish another salon’s ticket', async () => {
    const f = floor({ walkIns: [{ id: 'theirs', tenantId: 't2', status: 'SERVING', assignedStaffId: 'x', createdAt: at(0) }] });
    await expect(f.svc.assignLeg(admin, 'theirs', '_ticket', 'hana')).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.svc.doneLeg(admin, 'theirs', '_ticket')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.get('theirs').status).toBe('SERVING');
  });

  it('the dispatcher never seats another salon’s queue or uses its technicians', async () => {
    const f = floor({
      staff: [tech('hana'), tech('zoe', 't2')],
      walkIns: [waiting('theirs', 0, { tenantId: 't2' }), waiting('ours', 5)],
    });
    expect(await f.svc.seatWaitingQueue(T1)).toEqual(['ours']);
    expect(f.get('ours').assignedStaffId).toBe('hana');
    expect(f.get('theirs').status).toBe('WAITING');
  });

  it('cannot hand a leg to another salon’s technician', async () => {
    const f = floor({ staff: [tech('hana'), tech('zoe', 't2')] });
    const w = await f.svc.add(admin, { serviceIds: ['mani'] });
    await expect(f.svc.assignLeg(admin, w.id, f.legs(w.id)[0].legId, 'zoe')).rejects.toThrow('Technician not found');
  });
});
