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

/**
 * Deleting someone who has worked here used to cascade away their tips,
 * clock-ins and extra hours (past payroll changed) and left their login
 * working. Now: history → stopped, not deleted; login closed either way.
 */
describe('removing a staff member keeps the books whole', () => {
  function shop(history: { lines?: number; tips?: number; clock?: number }) {
    const people = [
      { id: 's-a', tenantId: 'tenant-a', firstName: 'Tina', userId: 'login-a', isActive: true },
      { id: 's-b', tenantId: 'tenant-b', firstName: 'Kim', userId: null, isActive: true },
    ];
    const logins = [{ id: 'login-a', tenantId: 'tenant-a', isActive: true }];
    const n = (v?: number) => jest.fn(async () => v ?? 0);
    const prisma: any = {
      staffMember: {
        findFirst: jest.fn(async ({ where }: any) => people.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => { people.filter((r) => r.id === where.id && r.tenantId === where.tenantId).forEach((r) => Object.assign(r, data)); return { count: 1 }; }),
        deleteMany: jest.fn(async ({ where }: any) => { const i = people.findIndex((r) => r.id === where.id && r.tenantId === where.tenantId); if (i >= 0) people.splice(i, 1); return { count: i >= 0 ? 1 : 0 }; }),
      },
      user: { updateMany: jest.fn(async ({ where, data }: any) => { logins.filter((u) => u.id === where.id && u.tenantId === where.tenantId).forEach((u) => Object.assign(u, data)); return { count: 1 }; }) },
      orderItem: { count: n(history.lines) },
      tipLog: { count: n(history.tips) },
      timeEntry: { count: n(history.clock) },
      staffExtraHours: { count: n() },
      staffRewardTransaction: { count: n() },
      appointment: { count: n() },
      service: { count: n() },
    };
    prisma.staffMember.findUnique = prisma.staffMember.findFirst;
    return { prisma, people, logins, svc: new StaffService(prisma, audit as any, {} as any) };
  }

  it('someone with bills or tips is stopped, not deleted, and cannot sign in', async () => {
    const s = shop({ lines: 3, tips: 1 });
    await expect(s.svc.remove(salonA, 's-a')).resolves.toMatchObject({ archived: true, deleted: false });
    expect(s.people.find((p) => p.id === 's-a')).toMatchObject({ isActive: false, takesAppointments: false });
    expect(s.prisma.staffMember.deleteMany).not.toHaveBeenCalled();
    expect(s.logins[0].isActive).toBe(false);
  });

  it('someone with no history is really deleted (login closed too)', async () => {
    const s = shop({});
    await expect(s.svc.remove(salonA, 's-a')).resolves.toMatchObject({ deleted: true });
    expect(s.people.map((p) => p.id)).toEqual(['s-b']);
    expect(s.logins[0].isActive).toBe(false);
  });

  it('another salon\'s staff cannot be removed', async () => {
    const s = shop({});
    await expect(s.svc.remove(salonA, 's-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(s.people.map((p) => p.id)).toEqual(['s-a', 's-b']);
  });
});
