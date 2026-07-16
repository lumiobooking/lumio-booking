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
    const svc = new StaffService(prisma as any, audit as any, {} as any);

    const result = await svc.list(salonA);

    expect(result.map((r: any) => r.id)).toEqual(['s-a']);
    expect(prisma.staffMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
  });

  it('getById on another tenant staff returns 404', async () => {
    const prisma = makePrisma([{ id: 's-b', tenantId: 'tenant-b', firstName: 'Kim' }]);
    const svc = new StaffService(prisma as any, audit as any, {} as any);

    await expect(svc.getById(salonA, 's-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Role drives whether a new staff member is a bookable technician. Receptionists
 * and managers must NOT default into the booking/assignment lists (the bug this
 * feature fixes), while an owner/manager who also does nails can opt in.
 */
function makeCreatePrisma() {
  const captured: any = {};
  const created = { id: 's-new', tenantId: 'tenant-a', firstName: 'Le' };
  const tx = {
    staffMember: {
      create: jest.fn(async ({ data }: any) => { Object.assign(captured, data); return created; }),
      update: jest.fn(async () => created),
    },
    staffService: { createMany: jest.fn(async () => ({})) },
    staffWorkingHour: { createMany: jest.fn(async () => ({})) },
    user: { create: jest.fn(async ({ data }: any) => ({ id: 'u-new', email: data.email })) },
  };
  const prisma = {
    service: { count: jest.fn(async () => 0) },
    user: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    staffMember: { findFirst: jest.fn(async () => ({ ...created, ...captured })) },
  };
  return { prisma, tx, captured };
}

describe('StaffService role → bookable derivation', () => {
  it('a receptionist is NOT bookable by default', async () => {
    const { prisma, captured } = makeCreatePrisma();
    const svc = new StaffService(prisma as any, audit as any, {} as any);
    await svc.create(salonA, { firstName: 'Le', staffRole: 'RECEPTIONIST' } as any);
    expect(captured.staffRole).toBe('RECEPTIONIST');
    expect(captured.takesAppointments).toBe(false);
  });

  it('a technician (default role) IS bookable', async () => {
    const { prisma, captured } = makeCreatePrisma();
    const svc = new StaffService(prisma as any, audit as any, {} as any);
    await svc.create(salonA, { firstName: 'Mai' } as any);
    expect(captured.takesAppointments).toBe(true);
  });

  it('a manager who also does nails can opt in', async () => {
    const { prisma, captured } = makeCreatePrisma();
    const svc = new StaffService(prisma as any, audit as any, {} as any);
    await svc.create(salonA, { firstName: 'Owner', staffRole: 'MANAGER', takesAppointments: true } as any);
    expect(captured.takesAppointments).toBe(true);
  });

  it('creates a linked login only when both email and password are given', async () => {
    const { prisma, tx } = makeCreatePrisma();
    const svc = new StaffService(prisma as any, audit as any, {} as any);
    await svc.create(salonA, { firstName: 'Front', staffRole: 'RECEPTIONIST', loginEmail: 'front@a.test', loginPassword: 'secret12' } as any);
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.staffMember.update).toHaveBeenCalled();
  });
});
