import { planMenuImport, dishKey, type MenuExisting } from './menu-import';
import { MenuService } from './menu.service';

/** "Phần nhập thực đơn chưa có template mẫu để làm theo và import" (5 Nov 2026). */
const dish = (id: string, name: string, category: string | null, priceCents: number, extra: Partial<MenuExisting> = {}): MenuExisting =>
  ({ id, name, category, priceCents, description: null, imageUrl: null, options: [], sortOrder: 0, ...extra });

describe('menu sheet → what happens to each row', () => {
  const menu = [dish('d1', 'Phở Bò Tái', 'Phở', 1400), dish('d2', 'Cà phê sữa đá', 'Đồ uống', 500, { description: 'Pha phin' })];

  it('new dishes are created; a dish the restaurant has is updated, never copied', () => {
    const p = planMenuImport(menu, [
      { name: 'pho bo tai', category: 'Phở', priceCents: 1500 },
      { name: 'Bún chả', category: 'Bún', priceCents: 1300 },
    ]);
    expect(p.create.map((c) => c.name)).toEqual(['Bún chả']);
    expect(p.update).toEqual([{ id: 'd1', data: { priceCents: 1500 } }]);
  });

  it('the same sheet twice changes nothing', () => {
    const p = planMenuImport(menu, [{ name: 'Phở Bò Tái', category: 'Phở', priceCents: 1400 }, { name: 'Cà phê sữa đá', category: 'Đồ uống', priceCents: 500 }]);
    expect(p).toMatchObject({ create: [], update: [], same: 2 });
  });

  it('a blank description or photo keeps what the app has; a filled one replaces it', () => {
    expect(planMenuImport(menu, [{ name: 'Cà phê sữa đá', category: 'Đồ uống', priceCents: 500, description: '' }]).same).toBe(1);
    expect(planMenuImport(menu, [{ name: 'Cà phê sữa đá', category: 'Đồ uống', priceCents: 500, description: 'Robusta' }]).update[0].data).toEqual({ description: 'Robusta' });
  });

  it('moved to another category: still the same dish', () => {
    expect(planMenuImport(menu, [{ name: 'Phở Bò Tái', category: 'Món chính', priceCents: 1400 }]).update[0]).toEqual({ id: 'd1', data: { category: 'Món chính' } });
  });

  it('options become groups; twice the same dish in the sheet is skipped; no name or no price is an error', () => {
    const p = planMenuImport([], [
      { name: 'Phở đặc biệt', priceCents: 1800, options: [{ name: 'Cỡ tô', required: true, max: 1, choices: [{ name: 'Thường' }, { name: 'Lớn', priceCents: 300 }] }] },
      { name: 'Phở đặc biệt', priceCents: 1800 },
      { name: '', priceCents: 100 },
      { name: 'Gỏi cuốn', priceCents: NaN },
    ]);
    expect(p.create).toHaveLength(1);
    expect(p.create[0].options[0]).toMatchObject({ name: 'Cỡ tô', required: true, choices: [{ name: 'Thường', priceCents: 0 }, { name: 'Lớn', priceCents: 300 }] });
    expect(p).toMatchObject({ duplicate: 1, error: 2 });
  });

  it('only a web address is kept as a photo', () => {
    const p = planMenuImport([], [{ name: 'A', priceCents: 1, imageUrl: 'javascript:alert(1)' }, { name: 'B', priceCents: 1, imageUrl: 'https://x.test/b.jpg' }]);
    expect(p.create.map((c) => c.imageUrl)).toEqual([null, 'https://x.test/b.jpg']);
  });

  it('accent-insensitive names', () => expect(dishKey('Phở Bò  Tái')).toBe(dishKey('pho bo tai')));
});

describe('the import writes only the caller\'s own menu', () => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function make(rows: Row[]) {
    const svc = Object.create(MenuService.prototype) as MenuService;
    const created: Row[] = [];
    Object.assign(svc as unknown as Row, {
      audit: { log: jest.fn(async () => undefined) },
      settings: { getBookingRules: jest.fn(async () => ({ currency: 'AUD' })) },
      prisma: {
        menuItem: {
          findMany: jest.fn(async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId)),
          createMany: jest.fn(async ({ data }: Row) => { created.push(...data); rows.push(...data.map((d: Row, i: number) => ({ id: `n${i}`, ...d }))); return { count: data.length }; }),
          updateMany: jest.fn(async ({ where, data }: Row) => { const hit = rows.filter((r) => r.id === where.id && r.tenantId === where.tenantId); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
        },
      },
    });
    return { svc, created };
  }
  const user = (tenantId: string) => ({ userId: 'u', tenantId, role: 'SALON_ADMIN' } as never);

  it('another restaurant\'s dish with the same name is neither matched nor touched', async () => {
    const rows = [{ id: 'b1', tenantId: 'B', name: 'Phở Bò Tái', category: 'Phở', priceCents: 999, description: null, imageUrl: null, options: [], sortOrder: 0 }];
    const { svc, created } = make(rows);
    const r = await svc.importMany(user('A'), [{ name: 'Phở Bò Tái', category: 'Phở', priceCents: 1400 }]);
    expect(r).toMatchObject({ created: 1, updated: 0 });
    expect(created[0]).toMatchObject({ tenantId: 'A', currency: 'AUD' });
    expect(rows[0].priceCents).toBe(999);
  });
});

describe('options already on the dish', () => {
  it('the same options under the editor\'s own ids are "unchanged", not rewritten', () => {
    const had = [{ id: 'size', name: 'Cỡ tô', required: true, max: 1, choices: [{ id: 'x1', name: 'Thường', priceCents: 0 }, { id: 'x2', name: 'Lớn', priceCents: 300 }] }];
    const p = planMenuImport([dish('d1', 'Phở', null, 1400, { options: had })], [{ name: 'Phở', priceCents: 1400, options: [{ name: 'Cỡ tô', required: true, max: 1, choices: [{ name: 'Thường' }, { name: 'Lớn', priceCents: 300 }] }] }]);
    expect(p.same).toBe(1);
  });
});
