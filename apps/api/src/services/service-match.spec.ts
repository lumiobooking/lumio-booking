/**
 * "Khi cập nhật service nếu bị trùng thì update chứ không tạo mới" and
 * "có service chọn xóa chưa xóa được" (3 Nov 2026):
 *  - a re-imported menu updates what the salon already has (loose name match,
 *    category part of the identity) instead of adding copies;
 *  - a double-clicked import runs once after the other, so it cannot copy the menu;
 *  - deleting a service that old bookings point at archives it instead of failing;
 *  - none of it reaches another salon.
 */
import { matchService, serviceChanges, serviceKey } from './service-match';
import { ServicesService } from './services.service';

const svc = (id: string, name: string, categoryName: string | null, extra: Record<string, unknown> = {}) => ({ id, name, categoryName, isActive: true, ...extra });

describe('which existing service a row stands for', () => {
  it('names compare without case, accents, spacing or dashes', () => {
    expect(serviceKey('Bio Gel – Full Set ')).toBe(serviceKey('bio gel full set'));
    expect(serviceKey('Gội đầu dưỡng sinh')).toBe('goi dau duong sinh');
    expect(serviceKey('Pink & White')).toBe('pink and white');
  });
  it('same name in the same category → that service', () => {
    const menu = [svc('m', 'Polish Change', 'Manicure'), svc('p', 'Polish Change', 'Pedicure')];
    expect(matchService(menu, { name: 'polish change', category: 'PEDICURE' })?.id).toBe('p');
    expect(matchService(menu, { name: 'Polish  Change', category: 'Manicure' })?.id).toBe('m');
  });
  it('a row without a category matches only an unambiguous name', () => {
    expect(matchService([svc('a', 'Gel Pedicure', 'Pedicure')], { name: 'Gel Pedicure' })?.id).toBe('a');
    expect(matchService([svc('m', 'Polish Change', 'Manicure'), svc('p', 'Polish Change', 'Pedicure')], { name: 'Polish Change' })).toBeNull();
  });
  it('a new category for the same name is a new service — unless the old one had no category at all', () => {
    expect(matchService([svc('m', 'Polish Change', 'Manicure')], { name: 'Polish Change', category: 'Pedicure' })).toBeNull();
    expect(matchService([svc('x', 'Signature Pedicure', null)], { name: 'Signature Pedicure', category: 'Pedicure' })?.id).toBe('x');
  });
  it('when the salon already has two copies, the one on the menu wins', () => {
    const menu = [svc('old-off', 'Full Leg', 'Waxing', { isActive: false, createdAt: '2026-01-01' }), svc('live', 'Full Leg', 'Waxing', { createdAt: '2026-02-01' })];
    expect(matchService(menu, { name: 'Full Leg', category: 'Waxing' })?.id).toBe('live');
  });
  it('changes: only what the file says differently; an archived service comes back; one switched off stays off', () => {
    expect(serviceChanges({ priceCents: 4000, durationMinutes: 45 }, { priceCents: 4000, durationMinutes: 45 })).toEqual({});
    expect(serviceChanges({ priceCents: 4000, durationMinutes: 45 }, { priceCents: 4500 })).toEqual({ priceCents: 4500 });
    expect(serviceChanges({ priceCents: 4000, archivedAt: new Date(), isActive: false }, { priceCents: 4000 })).toEqual({ archivedAt: null, isActive: true });
    expect(serviceChanges({ priceCents: 4000, isActive: false }, { priceCents: 4000 })).toEqual({});
  });
});

type Row = Record<string, unknown>;
function db() {
  const services: Row[] = [
    { id: 's-a', tenantId: 't1', name: 'Gel Pedicure', categoryId: 'c1', category: { name: 'Pedicure' }, priceCents: 4000, durationMinutes: 45, isActive: true },
    { id: 's-used', tenantId: 't1', name: 'Old Combo', categoryId: null, priceCents: 5000, durationMinutes: 60, isActive: true },
    { id: 's-free', tenantId: 't1', name: 'Never Booked', categoryId: null, priceCents: 1000, durationMinutes: 15, isActive: true },
    { id: 's-t2', tenantId: 't2', name: 'Gel Pedicure', categoryId: 'c2', category: { name: 'Pedicure' }, priceCents: 9900, durationMinutes: 45, isActive: true },
  ];
  const appointments: Row[] = [{ id: 'ap1', tenantId: 't1', serviceId: 's-used' }];
  const eq = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (row[k] ?? null) === v);
  let n = 0;
  let slowCreate = 0;
  const prisma = {
    serviceCategory: {
      findMany: async ({ where }: { where: Row }) => [{ id: 'c1', tenantId: 't1', name: 'Pedicure' }, { id: 'c2', tenantId: 't2', name: 'Pedicure' }].filter((c) => eq(c, where)),
      create: async ({ data }: { data: Row }) => ({ id: `c${++n}`, ...data }),
    },
    service: {
      findMany: async ({ where }: { where: Row }) => services.filter((s) => eq(s, where)),
      findFirst: async ({ where }: { where: Row }) => services.find((s) => eq(s, where)) ?? null,
      create: async ({ data }: { data: Row }) => { await new Promise((r) => setTimeout(r, slowCreate)); const r = { id: `new${++n}`, ...data }; services.push(r); return r; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = services.filter((s) => eq(s, where)); hit.forEach((s) => Object.assign(s, data)); return { count: hit.length }; },
      deleteMany: async ({ where }: { where: Row }) => { for (let i = services.length - 1; i >= 0; i--) if (eq(services[i], where)) services.splice(i, 1); return { count: 1 }; },
    },
    serviceAddon: { findMany: async () => [] },
    appointment: { count: async ({ where }: { where: Row }) => appointments.filter((a) => eq(a, where)).length },
    setting: { findUnique: async () => ({ value: { currency: 'USD' } }) },
  };
  return { prisma, services, setSlow: (ms: number) => { slowCreate = ms; } };
}
const admin = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);

describe('menu import updates instead of copying', () => {
  it('a new price for an existing service updates it; nothing is added twice; the other salon is untouched', async () => {
    const { prisma, services } = db();
    const s = new ServicesService(prisma as never, { log: jest.fn() } as never);
    const r = await s.bulkImport(admin('t1'), [{ kind: 'service', category: 'Pedicure', name: 'gel  pedicure', priceCents: 4500, durationMinutes: 50 }]);
    expect(r).toMatchObject({ createdServices: 0, updatedServices: 1 });
    expect(services.filter((x) => x.tenantId === 't1' && x.name === 'Gel Pedicure')).toHaveLength(1);
    expect(services.find((x) => x.id === 's-a')).toMatchObject({ priceCents: 4500, durationMinutes: 50 });
    expect(services.find((x) => x.id === 's-t2')).toMatchObject({ priceCents: 9900 });
  });
  it('the same file sent twice at once (double-click) adds each service once', async () => {
    const { prisma, services, setSlow } = db();
    setSlow(15);
    const s = new ServicesService(prisma as never, { log: jest.fn() } as never);
    const file = [{ kind: 'service' as const, category: 'Waxing', name: 'Full Leg', priceCents: 6000, durationMinutes: 40 }, { kind: 'service' as const, category: 'Waxing', name: 'Half Leg', priceCents: 3500, durationMinutes: 25 }];
    const [a, b] = await Promise.all([s.bulkImport(admin('t1'), file), s.bulkImport(admin('t1'), file)]);
    expect(a.createdServices + b.createdServices).toBe(2);
    expect(services.filter((x) => x.name === 'Full Leg')).toHaveLength(1);
  });
});

describe('deleting a service', () => {
  it('one with past bookings is archived (kept for history, off every list) instead of failing', async () => {
    const { prisma, services } = db();
    const s = new ServicesService(prisma as never, { log: jest.fn() } as never);
    expect(await s.remove(admin('t1'), 's-used')).toMatchObject({ deleted: true, archived: true, bookings: 1 });
    expect(services.find((x) => x.id === 's-used')).toMatchObject({ isActive: false });
    expect(services.find((x) => x.id === 's-used')?.archivedAt).toBeInstanceOf(Date);
  });
  it('one never booked is really deleted', async () => {
    const { prisma, services } = db();
    const s = new ServicesService(prisma as never, { log: jest.fn() } as never);
    expect(await s.remove(admin('t1'), 's-free')).toMatchObject({ deleted: true, archived: false });
    expect(services.find((x) => x.id === 's-free')).toBeUndefined();
  });
  it('another salon\'s service cannot be deleted or archived', async () => {
    const { prisma, services } = db();
    const s = new ServicesService(prisma as never, { log: jest.fn() } as never);
    await expect(s.remove(admin('t1'), 's-t2')).rejects.toBeTruthy();
    expect(services.find((x) => x.id === 's-t2')).toMatchObject({ isActive: true });
  });
});
