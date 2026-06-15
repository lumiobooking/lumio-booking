import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function guardWithRequiredRoles(roles: UserRole[] | undefined) {
    const reflector = {
      getAllAndOverride: () => roles,
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows any authenticated user when no roles are required', () => {
    const guard = guardWithRequiredRoles(undefined);
    const ctx = contextWithUser({ role: UserRole.STAFF });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    const guard = guardWithRequiredRoles([UserRole.SALON_ADMIN]);
    const ctx = contextWithUser({ role: UserRole.SALON_ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('BLOCKS a user whose role is not allowed', () => {
    const guard = guardWithRequiredRoles([UserRole.SUPER_ADMIN]);
    const ctx = contextWithUser({ role: UserRole.SALON_ADMIN });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
