import { NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { BookingsService } from '../bookings/bookings.service';

/**
 * "Take Off $5" — one extra offered on every Manicure service (or the whole
 * menu) instead of being re-added to each service. Never across salons.
 */

type Row = Record<string, unknown>;

/** Enough of Prisma's `where` for these queries: equality, null, `in`, OR. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && 'in' in (v as Row)) return ((v as { in: unknown[] }).in).includes(row[k]);
    return (row[k] ?? null) === v;
  });
}

function db() {
  const categories = [
    { id: 'mani', tenantId: 't1', name: 'Manicure' },
    { id: 'pedi', tenantId: 't1', name: 'Pedicure' },
    { id: 'other-mani', tenantId: 't2', name: 'Manicure' },
  ];
  const services: Row[] = [
    { id: 's-gel', tenantId: 't1', name: 'Manicure Gel', categoryId: 'mani', isActive: true, addons: [{ id: 'a-art', name: 'Nail art', durationMinutes: 10, priceCents: 1000, currency: 'USD' }] },
    { id: 's-spa', tenantId: 't1', name: 'Spa Pedicure', categoryId: 'pedi', isActive: true, addons: [] },
    { id: 's-x', tenantId: 't2', name: 'Other salon mani', categoryId: 'other-mani', isActive: true, addons: [] },
  ];
  const addons: Row[] = [
    { id: 'a-art', tenantId: 't1', serviceId: 's-gel', categoryId: null, name: 'Nail art', durationMinutes: 10, priceCents: 1000, currency: 'USD', isActive: true },
    { id: 'a-off', tenantId: 't1', serviceId: null, categoryId: 'mani', name: 'Take Off', durationMinutes: 10, priceCents: 500, currency: 'USD', isActive: true },
    { id: 'a-french', tenantId: 't1', serviceId: null, categoryId: null, name: 'French', durationMinutes: 5, priceCents: 700, currency: 'USD', isActive: true },
    { id: 'a-t2', tenantId: 't2', serviceId: null, categoryId: null, name: 'Other salon extra', durationMinutes: 5, priceCents: 100, currency: 'USD', isActive: true },
  ];
  const created: Row[] = [];
  const prisma = {
    serviceCategory: { findFirst: async ({ where }: { where: Row }) => categories.find((c) => matches(c, where)) ?? null },
    service: {
      findFirst: async ({ where }: { where: Row }) => services.find((s) => matches(s, where)) ?? null,
      findMany: async ({ where }: { where: Row }) => services.filter((s) => matches(s, where)),
    },
    serviceAddon: {
      findMany: async ({ where }: { where: Row }) => addons.filter((a) => matches(a, where)).map((a) => ({ ...a, category: categories.find((c) => c.id === a.categoryId) ?? null })),
      create: async ({ data }: { data: Row }) => { const r = { id: 'new', ...data }; created.push(r); return r; },
      deleteMany: async ({ where }: { where: Row }) => ({ count: addons.filter((a) => matches(a, where)).length }),
    },
  };
  return { prisma, created };
}
const admin = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);
const audit = { log: jest.fn() };

describe('shared extras in the admin', () => {
  it('a category extra appears on every service of that category, marked shared', async () => {
    const { prisma } = db();
    const svc = new ServicesService(prisma as never, audit as never);
    const gel = (await svc.listAddons(admin('t1'), 's-gel')) as Array<{ id: string; shared?: string; scopeName?: string | null }>;
    expect(gel.map((a) => a.id)).toEqual(['a-art', 'a-off', 'a-french']);
    expect(gel.find((a) => a.id === 'a-off')).toMatchObject({ shared: 'category', scopeName: 'Manicure' });
    expect(gel.find((a) => a.id === 'a-french')).toMatchObject({ shared: 'all' });
    const spa = (await svc.listAddons(admin('t1'), 's-spa')) as Array<{ id: string }>;
    expect(spa.map((a) => a.id)).toEqual(['a-french']); // not Manicure's Take Off
  });

  it('can be made for a category of THIS salon only', async () => {
    const { prisma, created } = db();
    const svc = new ServicesService(prisma as never, audit as never);
    await svc.createSharedAddon(admin('t1'), { name: 'Take Off', durationMinutes: 10, priceCents: 500, categoryId: 'mani' });
    expect(created[0]).toMatchObject({ tenantId: 't1', serviceId: null, categoryId: 'mani' });
    await expect(svc.createSharedAddon(admin('t1'), { name: 'X', durationMinutes: 0, priceCents: 0, categoryId: 'other-mani' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('another salon cannot delete it', async () => {
    const { prisma } = db();
    const svc = new ServicesService(prisma as never, audit as never);
    await expect(svc.removeSharedAddon(admin('t2'), 'a-off')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeSharedAddon(admin('t1'), 'a-off')).resolves.toMatchObject({ deleted: true });
  });

  it('the till groups a shared extra under its category', async () => {
    const { prisma } = db();
    const svc = new ServicesService(prisma as never, audit as never);
    const all = (await svc.listAllAddons(admin('t1'))) as Array<{ id: string; service: { name: string } | null }>;
    expect(all.find((a) => a.id === 'a-off')?.service?.name).toBe('Manicure');
    expect(all.find((a) => a.id === 'a-french')?.service?.name).toBe('All services');
    expect(all.some((a) => a.id === 'a-t2')).toBe(false);
  });
});

describe('the booking page', () => {
  it('offers each service its own extras plus the shared ones that fit — never another salon’s', async () => {
    const { prisma } = db();
    const svc = new BookingsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const menu = (await svc.publicServices('t1')) as Array<{ id: string; addons: Array<{ id: string }> }>;
    expect(menu.find((s) => s.id === 's-gel')!.addons.map((a) => a.id)).toEqual(['a-art', 'a-off', 'a-french']);
    expect(menu.find((s) => s.id === 's-spa')!.addons.map((a) => a.id)).toEqual(['a-french']);
    expect(JSON.stringify(menu)).not.toContain('a-t2');
  });
});
