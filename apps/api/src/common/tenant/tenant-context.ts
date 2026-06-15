import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * The authenticated principal attached to every request after the JWT guard
 * runs. `tenantId` is null ONLY for SUPER_ADMIN (platform-level).
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

/**
 * Throws if the resource being accessed does not belong to the caller's tenant.
 *
 * Rules:
 *   - SUPER_ADMIN may access any tenant's resource (platform management).
 *   - SALON_ADMIN / STAFF may only access resources whose tenantId matches
 *     their own tenantId.
 *
 * This is the single choke point every tenant-scoped service should call before
 * returning or mutating a resource, so cross-tenant access cannot leak.
 */
export function assertTenantAccess(user: AuthenticatedUser, resourceTenantId: string): void {
  if (user.role === UserRole.SUPER_ADMIN) {
    return;
  }
  if (!user.tenantId || user.tenantId !== resourceTenantId) {
    throw new ForbiddenException('Cross-tenant access is not allowed');
  }
}

/**
 * Resolves the tenantId that a query must be scoped to.
 *
 *   - SALON_ADMIN / STAFF: always their own tenantId (an attempt to override it
 *     with a different requestedTenantId is rejected).
 *   - SUPER_ADMIN: may target a specific tenant via requestedTenantId; if none
 *     is provided, returns null (caller decides platform-wide behavior).
 */
export function resolveTenantScope(
  user: AuthenticatedUser,
  requestedTenantId?: string | null,
): string | null {
  if (user.role === UserRole.SUPER_ADMIN) {
    return requestedTenantId ?? null;
  }

  if (!user.tenantId) {
    throw new ForbiddenException('User is not associated with a tenant');
  }

  if (requestedTenantId && requestedTenantId !== user.tenantId) {
    throw new ForbiddenException('Cross-tenant access is not allowed');
  }

  return user.tenantId;
}

/**
 * Merges the caller's tenantId into a Prisma `where` clause so every query is
 * automatically scoped. Non-super-admins can never widen the scope.
 *
 * Usage: prisma.service.findMany({ where: scopeByTenant(user, { isActive: true }) })
 */
export function scopeByTenant<T extends Record<string, unknown>>(
  user: AuthenticatedUser,
  where: T = {} as T,
  requestedTenantId?: string | null,
): T & { tenantId?: string } {
  const tenantId = resolveTenantScope(user, requestedTenantId);
  if (tenantId === null) {
    // SUPER_ADMIN with no specific tenant -> no tenant filter (platform-wide).
    return { ...where };
  }
  return { ...where, tenantId };
}
