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
  return {
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
      updateMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    _rows: rows,
  };
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
