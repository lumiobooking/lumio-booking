import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ServicesService } from './services.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// --- Lightweight in-memory fake of the parts of PrismaService we use. ---
interface FakeService {
  id: string;
  tenantId: string;
  name: string;
}

function makePrismaFake(seed: FakeService[]) {
  const rows = [...seed];
  const base = {
    service: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => r.tenantId === where.tenantId),
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `svc-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && r.tenantId === where.tenantId);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    serviceCategory: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    staffMember: { count: jest.fn(async () => 0) },
    // The fake had no $transaction at all, so every method that batches writes
    // — create, and now reorder — threw "not a function" and the suite carried
    // a permanent red. Both call shapes are supported: an array of promises and
    // an interactive callback.
    $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(fake))),
    _rows: rows,
  };
  const fake = base as Record<string, unknown>;
  return base;
}

const auditFake = { log: jest.fn(async () => undefined) };

const salonA: AuthenticatedUser = {
  userId: 'u-a',
  email: 'admin@salon-a.test',
  role: UserRole.SALON_ADMIN,
  tenantId: 'tenant-a',
};

describe('ServicesService tenant isolation', () => {
  it('list returns only the caller tenant services', async () => {
    const prisma = makePrismaFake([
      { id: 'svc-a', tenantId: 'tenant-a', name: 'Gel A' },
      { id: 'svc-b', tenantId: 'tenant-b', name: 'Gel B' },
    ]);
    const svc = new ServicesService(prisma as any, auditFake as any);

    const result = await svc.list(salonA);

    expect(result.map((r) => r.id)).toEqual(['svc-a']);
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });

  it('getById on another tenant service returns 404', async () => {
    const prisma = makePrismaFake([{ id: 'svc-b', tenantId: 'tenant-b', name: 'Gel B' }]);
    const svc = new ServicesService(prisma as any, auditFake as any);

    await expect(svc.getById(salonA, 'svc-b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create stamps the caller tenantId, ignoring any client value', async () => {
    const prisma = makePrismaFake([]);
    const svc = new ServicesService(prisma as any, auditFake as any);

    await svc.create(salonA, {
      name: 'New Service',
      durationMinutes: 30,
      priceCents: 2500,
    } as any);

    expect(prisma.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });

  it('update on another tenant service returns 404 before mutating', async () => {
    const prisma = makePrismaFake([{ id: 'svc-b', tenantId: 'tenant-b', name: 'Gel B' }]);
    const svc = new ServicesService(prisma as any, auditFake as any);

    await expect(svc.update(salonA, 'svc-b', { name: 'Hacked' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.service.updateMany).not.toHaveBeenCalled();
  });
});

describe('reordering the menu', () => {
  const seeded = () => makePrismaFake([
    { id: 'svc-1', tenantId: 'tenant-a', name: 'Package 1' },
    { id: 'svc-2', tenantId: 'tenant-a', name: 'Package 2' },
    { id: 'svc-3', tenantId: 'tenant-a', name: 'Package 3' },
    { id: 'svc-x', tenantId: 'tenant-b', name: 'Someone else' },
  ]);

  it('writes positions from the ARRAY, not from numbers the client sent', async () => {
    // The owner's complaint was "em để ngược rồi, phải thứ tự từ 1 đến 3".
    const prisma = seeded();
    const svc = new ServicesService(prisma as any, auditFake as any);
    const r = await svc.reorderServices(salonA, ['svc-1', 'svc-2', 'svc-3']);
    expect(r.ordered).toBe(3);
    const at = (id: string) => (prisma._rows.find((x: any) => x.id === id) as any).sortOrder;
    expect(at('svc-1')).toBeLessThan(at('svc-2'));
    expect(at('svc-2')).toBeLessThan(at('svc-3'));
  });

  it('leaves gaps so one insertion does not renumber the whole menu', async () => {
    const prisma = seeded();
    await new ServicesService(prisma as any, auditFake as any).reorderServices(salonA, ['svc-2', 'svc-1']);
    const at = (id: string) => (prisma._rows.find((x: any) => x.id === id) as any).sortOrder;
    expect(at('svc-2')).toBe(10);
    expect(at('svc-1')).toBe(20);
  });

  it('never touches another tenant’s service, even when its id is sent', async () => {
    // The tenant boundary is not a place for best effort: a foreign id is
    // dropped before any write, not written and hoped about.
    const prisma = seeded();
    const svc = new ServicesService(prisma as any, auditFake as any);
    const r = await svc.reorderServices(salonA, ['svc-x', 'svc-1']);
    expect(r.ordered).toBe(1);
    expect((prisma._rows.find((x: any) => x.id === 'svc-x') as any).sortOrder).toBeUndefined();
  });

  it('refuses an empty list rather than clearing the order', async () => {
    const svc = new ServicesService(seeded() as any, auditFake as any);
    await expect(svc.reorderServices(salonA, [])).rejects.toThrow();
  });

  it('ignores duplicates instead of giving two rows the same place', async () => {
    const prisma = seeded();
    const r = await new ServicesService(prisma as any, auditFake as any)
      .reorderServices(salonA, ['svc-1', 'svc-1', 'svc-2']);
    expect(r.ordered).toBe(2);
  });
});
