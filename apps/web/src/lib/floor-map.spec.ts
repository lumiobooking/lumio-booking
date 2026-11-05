import { planFloor, planScale, tableShape } from './floor-map';

const T = (id: string, seats: number, area: string) => ({ id, name: id.toUpperCase(), seats, area });

describe('the drawn floor plan', () => {
  it('sizes tables and chairs by seats and shape', () => {
    expect(tableShape(2)).toMatchObject({ round: true, top: 1, bottom: 1 });
    expect(tableShape(4)).toMatchObject({ round: false, w: 116, top: 2, bottom: 2 });
    expect(tableShape(10)).toMatchObject({ round: false, top: 5, bottom: 5 });
    expect(tableShape(6, 'round')).toMatchObject({ round: true, top: 3, bottom: 3 });
  });

  it('lays out a restaurant that never arranged its floor, one zone per area, nothing overlapping', () => {
    const tables = [T('v1', 10, 'Phòng VIP'), T('q1', 2, 'Quầy bar'), T('q2', 2, 'Quầy bar'), T('t1', 2, 'Trong nhà'), T('t2', 4, 'Trong nhà'), T('t3', 6, 'Trong nhà')];
    const p = planFloor(tables, null);
    expect(p.tables).toHaveLength(6);
    expect(p.zones.map((z) => z.area)).toEqual(['Phòng VIP', 'Quầy bar', 'Trong nhà']);
    for (const a of p.tables) for (const b of p.tables) {
      if (a.id >= b.id) continue;
      const apart = a.x + a.boxW <= b.x || b.x + b.boxW <= a.x || a.y + a.boxH <= b.y || b.y + b.boxH <= a.y;
      expect(apart).toBe(true);
    }
    for (const t of p.tables) {
      const z = p.zones.find((x) => x.area === t.area)!;
      expect(t.x >= z.x && t.y >= z.y && t.x + t.boxW <= z.x + z.w && t.y + t.boxH <= z.y + z.h).toBe(true);
    }
  });

  it('keeps the owner’s spots and puts unplaced tables underneath', () => {
    const p = planFloor([T('a', 2, 'A'), T('b', 4, 'A'), T('c', 2, 'B')], { a: { x: 10, y: 6, shape: 'round' }, b: { x: 40, y: 6, shape: 'square' } });
    const a = p.tables.find((t) => t.id === 'a')!;
    const b = p.tables.find((t) => t.id === 'b')!;
    const c = p.tables.find((t) => t.id === 'c')!;
    expect(a.x).toBe(120);
    expect(b.x).toBe(480);
    expect(a.y).toBe(b.y);
    expect(c.y).toBeGreaterThan(Math.max(a.y + a.boxH, b.y + b.boxH));
  });

  it('shrinks to fit but keeps phone tables tappable', () => {
    expect(planScale(1200, 900, false)).toBe(0.75);
    expect(planScale(1200, 1600, false)).toBe(1);
    expect(planScale(1200, 360, true)).toBe(0.62);
  });
});
