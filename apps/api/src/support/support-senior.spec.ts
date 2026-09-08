// SupportService reaches password hashing through one import; this test never
// touches it, and the native binding is not worth loading to find that out.
jest.mock('bcrypt', () => ({ hash: async () => 'hashed', compare: async () => true }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SupportService, SUPPORT_ROLE } from './support.service';
import type { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * Who may move a salon between teams.
 *
 * This is here because the check got it wrong once, in a way no type could
 * catch: `supportLevel` lives on the SHORT-LIVED token minted when an employee
 * steps into one salon, and the salon-picker screen is not that. Reading the
 * absent field as a level meant every full-level employee was refused on the
 * one screen the teams were built for, and the owner became the bottleneck the
 * feature exists to remove.
 */
describe('who may reassign a salon', () => {
  const svcFor = (row: { supportLevel?: string | null } | null) => {
    const prisma = {
      user: {
        findFirst: async () => row,
        update: async () => ({}),
      },
      tenant: {
        findFirst: async () => ({ id: 't1' }),
        update: async () => ({}),
        // Only t1 and t2 still exist; t3 was deleted.
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => id === 't1' || id === 't2').map((id) => ({ id })),
        updateMany: async () => ({ count: 2 }),
      },
      auditLog: { create: async () => ({}), createMany: async () => ({ count: 2 }) },
    };
    return new SupportService(prisma as never, {} as never, {} as never, {} as never);
  };

  const employee = (supportLevel?: string | null): AuthenticatedUser => ({
    userId: 'u1', email: 'a@lumioagency.com', role: SUPPORT_ROLE, tenantId: null, supportLevel,
  } as AuthenticatedUser);

  it('LETS A FULL-LEVEL EMPLOYEE ASSIGN from the salon picker, where the token carries no level', async () => {
    const svc = svcFor({ supportLevel: 'full' });
    await expect(svc.setTenantTeam(employee(null), 't1', 'Nhóm 1')).resolves.toMatchObject({ ok: true, team: 'Nhóm 1' });
  });

  it('still refuses an ordinary employee, whose row says setup', async () => {
    const svc = svcFor({ supportLevel: 'setup' });
    await expect(svc.setTenantTeam(employee(null), 't1', 'Nhóm 1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a content-level employee too', async () => {
    const svc = svcFor({ supportLevel: 'content' });
    await expect(svc.setAccountTeam(employee(null), 'u2', 'Nhóm 1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('trusts the level frozen into a per-salon token when there is one', async () => {
    // Inside a salon the token IS the answer — the row is not consulted, so a
    // level changed mid-session does not retroactively rewrite what a session
    // was allowed to do.
    const svc = svcFor({ supportLevel: 'setup' });
    await expect(svc.setTenantTeam(employee('full'), 't1', 'Nhóm 2')).resolves.toMatchObject({ ok: true });
  });

  it('lets the owner through without asking any row at all', async () => {
    const svc = svcFor(null);
    const owner = { userId: 'o1', email: 'o@x.com', role: UserRole.SUPER_ADMIN, tenantId: null } as AuthenticatedUser;
    await expect(svc.setTenantTeam(owner, 't1', '')).resolves.toMatchObject({ ok: true, team: null });
  });
});

describe('filing a whole batch at once', () => {
  const prisma = {
    user: { findFirst: async () => ({ supportLevel: 'full' }) },
    tenant: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => id !== 'deleted').map((id) => ({ id })),
      updateMany: async () => ({ count: 0 }),
    },
    auditLog: { createMany: async () => ({ count: 0 }) },
  };
  const svc = () => new SupportService(prisma as never, {} as never, {} as never, {} as never);
  const owner = { userId: 'o1', email: 'o@x.com', role: UserRole.SUPER_ADMIN, tenantId: null } as AuthenticatedUser;

  it('files everything that still exists, and says how many', async () => {
    await expect(svc().setTeamForMany(owner, ['a', 'b', 'c'], ' Nhóm 1 '))
      .resolves.toEqual({ ok: true, count: 3, team: 'Nhóm 1' });
  });

  it('DOES NOT resurrect a deleted salon onto a team from a stale tab', async () => {
    const r = await svc().setTeamForMany(owner, ['a', 'deleted', 'b'], 'Nhóm 1');
    expect(r.count).toBe(2);
  });

  it('ignores blanks and duplicates rather than counting them', async () => {
    const r = await svc().setTeamForMany(owner, ['a', 'a', '', '  ', 'b'], 'Nhóm 1');
    expect(r.count).toBe(2);
  });

  it('refuses an empty selection instead of silently clearing every team', async () => {
    await expect(svc().setTeamForMany(owner, [], 'Nhóm 1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc().setTeamForMany(owner, 'not an array', 'Nhóm 1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('holds the same bar as the single move', async () => {
    const junior = new SupportService(
      { ...prisma, user: { findFirst: async () => ({ supportLevel: 'setup' }) } } as never,
      {} as never, {} as never, {} as never,
    );
    const staff = { userId: 'u1', email: 'a@b.com', role: SUPPORT_ROLE, tenantId: null } as AuthenticatedUser;
    await expect(junior.setTeamForMany(staff, ['a'], 'Nhóm 1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
