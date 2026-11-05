import { planTableImport, shapeOf, spotOf } from './table-import';
import { TablesService } from './tables.service';

/** "Nhập sơ đồ bàn chưa có template mẫu để làm theo và import" (5 Nov 2026). */
describe('floor-plan sheet → tables and where they stand', () => {
  const tables = [{ id: 't1', name: 'Bàn 1', seats: 4, area: 'Trong nhà', sortOrder: 0 }];

  it('row / column become the map\'s grid; shapes in either language', () => {
    expect(spotOf(1, 1)).toEqual({ x: 4, y: 6 });
    expect(spotOf(2, 3)).toEqual({ x: 34, y: 24 });
    expect(spotOf(null, 2)).toBeNull();
    expect(['tròn', 'Vuông', 'dài', 'chữ nhật', 'Round', 'long', 'tam giác'].map(shapeOf)).toEqual(['round', 'square', 'long', 'long', 'round', 'long', null]);
  });

  it('new tables are created with their spot; a table with that name is updated, never doubled', () => {
    const p = planTableImport(tables, [
      { name: 'ban 1', seats: 6, row: 1, col: 1, shape: 'dài' },
      { name: 'Bàn 2', seats: 2, area: 'Sân', row: 1, col: 2 },
    ]);
    expect(p.update).toEqual([{ id: 't1', data: { seats: 6 }, spot: { x: 4, y: 6, shape: 'long' } }]);
    expect(p.create).toEqual([{ name: 'Bàn 2', seats: 2, area: 'Sân', sortOrder: 2, spot: { x: 19, y: 6 } }]);
  });

  it('the same sheet twice changes nothing — the table already stands there', () => {
    const p = planTableImport(tables, [{ name: 'Bàn 1', seats: 4, row: 1, col: 1, shape: 'tròn' }], { t1: { x: 4, y: 6, shape: 'round' } });
    expect(p).toMatchObject({ create: [], update: [], same: 1 });
  });

  it('a duplicate name is skipped; no name or impossible seats is an error', () => {
    const p = planTableImport([], [{ name: 'A', seats: 2 }, { name: 'a', seats: 4 }, { name: '', seats: 2 }, { name: 'B', seats: 0 }, { name: 'C', seats: 99 }]);
    expect(p).toMatchObject({ duplicate: 1, error: 3 });
  });
});

describe('the import writes only the caller\'s own tables and floor', () => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function make(tables: Row[], settings: Row[]) {
    const svc = Object.create(TablesService.prototype) as TablesService;
    let n = 0;
    Object.assign(svc as unknown as Row, {
      audit: { log: jest.fn(async () => undefined) },
      prisma: {
        restaurantTable: {
          findMany: jest.fn(async ({ where }: Row) => tables.filter((t) => t.tenantId === where.tenantId).map((t) => ({ isActive: true, ...t }))),
          create: jest.fn(async ({ data }: Row) => { const t = { id: `new${++n}`, isActive: true, ...data }; tables.push(t); return t; }),
          updateMany: jest.fn(async ({ where, data }: Row) => { const hit = tables.filter((t) => t.id === where.id && t.tenantId === where.tenantId); hit.forEach((t) => Object.assign(t, data)); return { count: hit.length }; }),
        },
        setting: {
          findUnique: jest.fn(async ({ where }: Row) => settings.find((s) => s.tenantId === where.tenantId_key.tenantId && s.key === where.tenantId_key.key) ?? null),
          upsert: jest.fn(async ({ where, create, update }: Row) => {
            const s = settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key);
            if (s) Object.assign(s, update); else settings.push({ ...create });
          }),
        },
      },
    });
    return svc;
  }
  const user = (tenantId: string) => ({ userId: 'u', tenantId, role: 'SALON_ADMIN' } as never);

  it('salon A\'s import creates A\'s table and writes A\'s layout; B\'s same-named table and layout stay as they were', async () => {
    const tables = [{ id: 'b1', tenantId: 'B', name: 'Bàn 1', seats: 8, area: null, sortOrder: 0 }];
    const settings = [{ tenantId: 'B', key: 'table_layout', value: { b1: { x: 50, y: 50, shape: 'long' } } }];
    const svc = make(tables, settings);
    const r = await svc.importMany(user('A'), [{ name: 'Bàn 1', seats: 4, row: 2, col: 2, shape: 'vuông' }]);
    expect(r).toMatchObject({ created: 1, updated: 0, placed: 1 });
    expect(tables.find((t) => t.id === 'b1')).toMatchObject({ seats: 8 });
    const a = settings.find((s) => s.tenantId === 'A')!;
    expect(a.value).toEqual({ new1: { x: 19, y: 24, shape: 'square' } });
    expect(settings.find((s) => s.tenantId === 'B')!.value).toEqual({ b1: { x: 50, y: 50, shape: 'long' } });
  });
});
