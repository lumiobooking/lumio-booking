/**
 * Importing a whole menu — services AND the extras (add-ons) in one file,
 * with the walk-in turn value per service. Extras land on the category the
 * file names (created by the same file when new) or on the whole menu; a
 * re-import adds nothing twice; one salon's import never touches another's.
 */
import { ServicesService } from './services.service';

type Row = Record<string, unknown>;

function db() {
  const categories: Row[] = [{ id: 'c-old', tenantId: 't1', name: 'Pedicure' }, { id: 'c-t2', tenantId: 't2', name: 'Full Set' }];
  const services: Row[] = [{ id: 's-old', tenantId: 't1', name: 'Signature Pedicure' }];
  const addons: Row[] = [{ id: 'a-old', tenantId: 't1', serviceId: null, categoryId: 'c-old', name: 'Gel Polish Upgrade' }];
  const eq = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (row[k] ?? null) === v);
  let n = 0;
  const prisma = {
    serviceCategory: {
      findMany: async ({ where }: { where: Row }) => categories.filter((c) => eq(c, where)),
      create: async ({ data }: { data: Row }) => { const r = { id: `c${++n}`, ...data }; categories.push(r); return r; },
    },
    service: {
      findMany: async ({ where }: { where: Row }) => services.filter((s) => eq(s, where)),
      create: async ({ data }: { data: Row }) => { const r = { id: `s${++n}`, ...data }; services.push(r); return r; },
    },
    serviceAddon: {
      findMany: async ({ where }: { where: Row }) => addons.filter((a) => eq(a, where)),
      create: async ({ data }: { data: Row }) => { const r = { id: `a${++n}`, ...data }; addons.push(r); return r; },
    },
    setting: { findUnique: async () => ({ value: { currency: 'USD' } }) },
  };
  return { prisma, categories, services, addons };
}
const admin = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);

describe('menu import with add-ons and turns', () => {
  it('creates categories, services (with turn values) and category / whole-menu extras; skips what exists', async () => {
    const { prisma, categories, services, addons } = db();
    const svc = new ServicesService(prisma as never, { log: jest.fn() } as never);
    const r = await svc.bulkImport(admin('t1'), [
      { kind: 'service', category: 'Full Set', name: 'Pink & White', priceCents: 6500, priceFrom: true, durationMinutes: 75, turnValue: 1 },
      { kind: 'service', category: 'Waxing', name: 'Lip', priceCents: 800, durationMinutes: 10, turnValue: 0.5 },
      { kind: 'service', category: 'Pedicure', name: 'Signature Pedicure', priceCents: 5000 }, // already there
      { kind: 'addon', category: 'Full Set', name: 'Chrome', priceCents: 1500, durationMinutes: 10 },   // category made by this same file
      { kind: 'addon', category: '', name: 'Take Off', priceCents: 1000, durationMinutes: 15 },         // whole menu
      { kind: 'addon', category: 'Pedicure', name: 'Gel Polish Upgrade', priceCents: 2000 },           // already there
      { kind: 'addon', category: 'Nowhere', name: 'Ghost', priceCents: 100 },                           // no such category
    ]);
    expect(r).toEqual({ createdCategories: 2, createdServices: 2, createdAddons: 2, skipped: 3 });
    const fullSet = categories.find((c) => c.name === 'Full Set' && c.tenantId === 't1')!;
    expect(services.find((s) => s.name === 'Pink & White')).toMatchObject({ tenantId: 't1', categoryId: fullSet.id, priceFrom: true, turnValue: 1 });
    expect(services.find((s) => s.name === 'Lip')).toMatchObject({ tenantId: 't1', turnValue: 0.5 });
    expect(addons.find((a) => a.name === 'Chrome')).toMatchObject({ tenantId: 't1', serviceId: null, categoryId: fullSet.id, priceCents: 1500 });
    expect(addons.find((a) => a.name === 'Take Off')).toMatchObject({ tenantId: 't1', serviceId: null, categoryId: null });
    expect(addons.filter((a) => a.name === 'Gel Polish Upgrade')).toHaveLength(1);
    expect(addons.find((a) => a.name === 'Ghost')).toBeUndefined();
    // The other salon's "Full Set" category was never used: t1 got its own.
    expect(fullSet.id).not.toBe('c-t2');
  });

  it('a salon admin cannot aim the import at another salon', async () => {
    const { prisma } = db();
    const svc = new ServicesService(prisma as never, { log: jest.fn() } as never);
    await expect(svc.bulkImport(admin('t1'), [{ name: 'X', priceCents: 1 }], 't2')).rejects.toBeTruthy();
  });
});
