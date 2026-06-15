import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StaffService } from './staff.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

interface FakeStaff {
  id: string;
  tenantId: string;
  firstName: string;
}

function makePrisma(seed: FakeStaff[]) {
  const rows = [...seed];
  return {
    staffMember: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.tenantId === where.tenantId)),
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
      ),
    },
    service: { count: jest.fn(async () => 0) },
  };
}

const audit = { log: jest.fn(async () => undefined) };

const salonA: AuthenticatedUser = {
  userId: 'u-a',
  email: 'admin@salon-a.test',
  role: UserRole.SALON_ADMIN,
  tenantId: 'tenant-a',
};

describe('StaffService tenant isolation', () => {
  it('list returns only the caller tenant staff', async () => {
    const prisma = makePrisma([
      { id: 's-a', tenantId: 'tenant-a', firstName: 'Tina' },
      { id: 's-b', tenantId: 'tenant-b', firstName: 'Kim' },
    ]);
    const svc = new StaffService(prisma as any, audit as any);

    const result = await svc.list(salonA);

    expect(result.map((r: any) => r.id)).toEqual(['s-a']);
    expect(prisma.staffMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });

  it('getById on another tenant staff returns 404', async () => {
    const prisma = makePrisma([{ id: 's-b', tenantId: 'tenant-b', firstName: 'Kim' }]);
    const svc = new StaffService(prisma as any, audit as any);

    await expect(svc.getById(salonA, 's-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});
