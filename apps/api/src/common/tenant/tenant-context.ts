import { ForbiddenException } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';

/**
 * The authenticated principal attached to every request after the JWT guard
 * runs. `tenantId` is null ONLY for SUPER_ADMIN (platform-level).
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  // The ACTIVE tenant for this request. Normally the user's home salon, but for a
  // multi-branch (chain) owner/manager it can be re-scoped to a selected branch by
  // the BranchScopeInterceptor (validated against their allowed branches).
  tenantId: string | null;
  // The user's permanent home salon (unchanged by branch switching). Set when the
  // active branch differs, so chain features can still find the original.
  homeTenantId?: string | null;
  // STAFF feature-permission sub-role (null for owners/super-admin = full access).
  staffRole?: StaffRole | null;
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
