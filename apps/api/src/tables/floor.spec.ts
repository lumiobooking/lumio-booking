import { UserRole } from '@prisma/client';
import { arrangeByNumber, cleanLayout, preOrderOf, tableStates, waitingForTable, withDefaults, TableLike, ResLike } from './floor';
import { TablesService } from './tables.service';

const T = (id: string, seats = 4, area: string | null = 'Main', sortOrder = 0, isActive = true): TableLike => ({ id, name: id.toUpperCase(), seats, area, isActive, sortOrder });
const AT = new Date('2026-10-07T19:00:00Z');
const R = (id: string, tableId: string, startMin: number, durMin: number, status = 'CONFIRMED'): ResLike => ({
  id, tableId, status, partySize: 2, customerName: 'Ann',
  startTime: new Date(AT.getTime() + startMin * 60_000), endTime: new Date(AT.getTime() + (startMin + durMin) * 60_000),
});

describe('floor map — cleanLayout', () => {
  it('keeps only this restaurant\'s tables, clamps to the grid, defaults the shape', () => {
    const out = cleanLayout({ a: { x: 150, y: -4, shape: 'long' }, b: { x: '12.34', y: 7, shape: 'hexagon' }, foreign: { x: 1, y: 1 }, c: { x: 'nope', y: 1 } }, ['a', 'b', 'c']);
    expect(out).toEqual({ a: { x: 96, y: 0, shape: 'long' }, b: { x: 12.3, y: 7, shape: 'round' } });
    expect(out.foreign).toBeUndefined();
  });
  it('ignores junk input', () => {
    expect(cleanLayout(null, ['a'])).toEqual({});
    expect(cleanLayout([1, 2], ['a'])).toEqual({});
    expect(cleanLayout('x', ['a'])).toEqual({});
  });
});

describe('floor map — withDefaults', () => {
  it('places unplaced active tables area by area, keeps saved spots, skips inactive', () => {
    const tables = [T('a', 2), T('b', 8), T('c', 4, 'Patio'), T('d', 4, 'Main', 0, false), T('e')];
    const out = withDefaults(tables, { e: { x: 50, y: 50, shape: 'square' } });
    expect(out.e).toEqual({ x: 50, y: 50, shape: 'square' });
    expect(out.d).toBeUndefined();
    expect(out.a.shape).toBe('round');
    expect(out.b.shape).toBe('long');
    expect(out.c.y).toBeGreaterThan(out.a.y); // next area on a new row
    for (const s of Object.values(out)) { expect(s.x).toBeLessThanOrEqual(96); expect(s.y).toBeLessThanOrEqual(90); }
  });
});

describe('floor map — tableStates', () => {
  const tables = [T('a'), T('b'), T('c'), T('d'), T('x', 4, 'Main', 0, false)];
  const res = [
    R('r1', 'a', -30, 90),            // running now → seated
    R('r2', 'b', 40, 90),             // starts in 40 min → soon
    R('r3', 'c', 120, 90),            // in 2h → free (next shown)
    R('r4', 'd', -10, 60, 'CANCELLED'), // cancelled → ignored
    R('r5', 'd', -120, 60, 'COMPLETED'),
  ];
  const states = tableStates(tables, res, AT);
  const by = Object.fromEntries(states.map((s) => [s.id, s]));
  it('paints seated / soon / free', () => {
    expect(by.a.state).toBe('seated');
    expect(by.a.current?.id).toBe('r1');
    expect(by.b.state).toBe('soon');
    expect(by.b.next?.id).toBe('r2');
    expect(by.c.state).toBe('free');
    expect(by.c.next?.id).toBe('r3');
    expect(by.d.state).toBe('free');
    expect(by.d.current).toBeNull();
  });
  it('leaves inactive tables off the map', () => {
    expect(by.x).toBeUndefined();
  });
});

describe('floor map — pre-order from the notes', () => {
  it('reads the dishes written by the booking', () => {
    expect(preOrderOf('Window · Pre-order: 2× Phở bò, 1× Gỏi cuốn')).toBe('2× Phở bò, 1× Gỏi cuốn');
    expect(preOrderOf('Pre-order: 1× Cà phê · Note: allergy')).toBe('1× Cà phê');
    expect(preOrderOf(null)).toBeNull();
  });
});

describe('floor map — waitingForTable', () => {
  it('lists live reservations with no table, from 1h ago to 3h ahead, earliest first', () => {
    const free = (id: string, start: number, status = 'CONFIRMED'): ResLike => ({ ...R(id, 'x', start, 60, status), tableId: null });
    const out = waitingForTable([free('late', 200), free('b', 90), free('a', -30), free('old', -90), free('gone', 10, 'CANCELLED'), R('seated', 'a', 5, 60)], AT);
    expect(out.map((w) => w.id)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({ party: 2, name: 'Ann' });
  });
});

describe('TablesService floor — tenant isolation', () => {
  const owner = (tenantId: string) => ({ userId: 'u-' + tenantId, role: UserRole.SALON_ADMIN, tenantId } as never);
  function make() {
    const prisma = {
      restaurantTable: { findMany: jest.fn().mockResolvedValue([T('a')]) },
      setting: { findUnique: jest.fn().mockResolvedValue({ value: { a: { x: 10, y: 10, shape: 'round' }, b: { x: 1, y: 1 } } }), upsert: jest.fn().mockResolvedValue({}) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { prisma, audit, svc: new TablesService(prisma as never, audit as never) };
  }

  it('reads tables, layout and reservations of the caller\'s restaurant only', async () => {
    const { prisma, svc } = make();
    const out = await svc.floor(owner('t1'), AT.toISOString());
    expect(prisma.restaurantTable.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    expect(prisma.setting.findUnique.mock.calls[0][0].where.tenantId_key.tenantId).toBe('t1');
    expect(prisma.appointment.findMany.mock.calls[0][0].where.tenantId).toBe('t1');
    expect(Object.keys(out.layout)).toEqual(['a']); // a foreign id in the stored blob never surfaces
    expect(out.waiting).toEqual([]);
  });

  it('"Tự xếp theo số bàn" reads only the caller\'s tables and saves nothing', async () => {
    const { prisma, svc } = make();
    const out = await svc.arrange(owner('t3'), 8);
    expect(prisma.restaurantTable.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't3' });
    expect(prisma.setting.findUnique.mock.calls[0][0].where.tenantId_key.tenantId).toBe('t3');
    expect(Object.keys(out.layout)).toEqual(['a']);
    expect(out.layout.a.shape).toBe('round'); // the saved shape is kept
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('marks tables with no saved spot as unplaced', async () => {
    const { prisma, svc } = make();
    prisma.restaurantTable.findMany.mockResolvedValue([T('a'), T('z')]);
    const out = await svc.floor(owner('t1'), AT.toISOString());
    expect(out.unplaced).toEqual(['z']);
  });

  it('saves the layout under the caller\'s tenant, drops other restaurants\' table ids, audits', async () => {
    const { prisma, audit, svc } = make();
    const out = await svc.saveLayout(owner('t2'), { a: { x: 5, y: 5 }, 'table-of-t1': { x: 9, y: 9 } });
    expect(prisma.restaurantTable.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't2' });
    const up = prisma.setting.upsert.mock.calls[0][0];
    expect(up.where.tenantId_key).toEqual({ tenantId: 't2', key: 'table_layout' });
    expect(up.create.tenantId).toBe('t2');
    expect(out.layout).toEqual({ a: { x: 5, y: 5, shape: 'round' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't2', action: 'tables.layout_updated' }));
  });

  it('refuses a user with no restaurant', async () => {
    const { svc } = make();
    await expect(svc.floor({ userId: 'x', role: UserRole.SALON_ADMIN, tenantId: null } as never)).rejects.toThrow();
  });
});

describe('floor map — a table added later never sits on another (Nẫu Chill Đêm, Bàn 33–35)', () => {
  const named = (n: number, seats = 4): TableLike => ({ id: `t${n}`, name: `Bàn ${n}`, seats, area: null, isActive: true, sortOrder: 0 });
  it('goes below the arranged tables, in number order, never overlapping', () => {
    const tables = Array.from({ length: 35 }, (_, i) => named(i + 1));
    const saved = arrangeByNumber(tables.slice(0, 32), 8);
    const out = withDefaults(tables, saved);
    const maxSaved = Math.max(...Object.values(saved).map((p) => p.y));
    for (const n of [33, 34, 35]) expect(out[`t${n}`].y).toBeGreaterThan(maxSaved);
    expect(out.t33.x).toBeLessThan(out.t34.x);
    const spots = Object.values(out);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      expect(Math.abs(spots[i].x - spots[j].x) >= 10 || Math.abs(spots[i].y - spots[j].y) >= 10).toBe(true);
    }
  });
  it('"Tự xếp theo số bàn": 1, 2 … 10 in reading order (not 1, 10, 2), 8 a row, shapes kept', () => {
    const tables = [named(10, 10), named(2), named(1), named(33, 2), ...Array.from({ length: 8 }, (_, i) => named(i + 3))];
    const out = arrangeByNumber(tables, 8, { t10: { x: 0, y: 0, shape: 'long' } });
    const reading = Object.entries(out).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x).map(([id]) => id);
    expect(reading.slice(0, 10)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10']);
    expect(reading[10]).toBe('t33');
    expect(out.t10.shape).toBe('long');
    expect(out.t9.y).toBeGreaterThan(out.t8.y);
  });
});
