// SupportService reaches password hashing through one import; this test never
// touches it, and the native binding is not worth loading to find that out.
jest.mock('bcrypt', () => ({ hash: async () => 'hashed', compare: async () => true }));

import { ForbiddenException } from '@nestjs/common';
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
      },
      auditLog: { create: async () => ({}) },
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
