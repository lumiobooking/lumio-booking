import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  AuthenticatedUser,
  assertTenantAccess,
  resolveTenantScope,
  scopeByTenant,
} from './tenant-context';

// Test fixtures: one user per tenant + a super admin.
const salonAAdmin: AuthenticatedUser = {
  userId: 'u-a',
  email: 'admin@salon-a.test',
  role: UserRole.SALON_ADMIN,
  tenantId: 'tenant-a',
};

const salonAStaff: AuthenticatedUser = {
  userId: 'u-a-staff',
  email: 'staff@salon-a.test',
  role: UserRole.STAFF,
  tenantId: 'tenant-a',
};

const superAdmin: AuthenticatedUser = {
  userId: 'u-super',
  email: 'superadmin@lumio.test',
  role: UserRole.SUPER_ADMIN,
  tenantId: null,
};

describe('Tenant isolation', () => {
  describe('assertTenantAccess', () => {
    it('allows a salon admin to access their own tenant resource', () => {
      expect(() => assertTenantAccess(salonAAdmin, 'tenant-a')).not.toThrow();
    });

    it('BLOCKS a salon admin from accessing another tenant resource', () => {
      // Core requirement: Tenant A must never reach Tenant B's data.
      expect(() => assertTenantAccess(salonAAdmin, 'tenant-b')).toThrow(ForbiddenException);
    });

    it('BLOCKS a staff member from accessing another tenant resource', () => {
      expect(() => assertTenantAccess(salonAStaff, 'tenant-b')).toThrow(ForbiddenException);
    });

    it('allows super admin to access any tenant resource', () => {
      expect(() => assertTenantAccess(superAdmin, 'tenant-a')).not.toThrow();
      expect(() => assertTenantAccess(superAdmin, 'tenant-b')).not.toThrow();
    });
  });

  describe('resolveTenantScope', () => {
    it('forces a salon user to their own tenantId', () => {
      expect(resolveTenantScope(salonAAdmin)).toBe('tenant-a');
    });

    it('rejects a salon user trying to override the tenantId', () => {
      expect(() => resolveTenantScope(salonAAdmin, 'tenant-b')).toThrow(ForbiddenException);
    });

    it('lets super admin target a specific tenant', () => {
      expect(resolveTenantScope(superAdmin, 'tenant-b')).toBe('tenant-b');
    });

    it('returns null for super admin with no target (platform-wide)', () => {
      expect(resolveTenantScope(superAdmin)).toBeNull();
    });
  });

  describe('scopeByTenant', () => {
    it('injects the caller tenantId into a where clause', () => {
      const where = scopeByTenant(salonAAdmin, { isActive: true });
      expect(where).toEqual({ isActive: true, tenantId: 'tenant-a' });
    });

    it('cannot be widened to another tenant by a salon user', () => {
      expect(() => scopeByTenant(salonAAdmin, { isActive: true }, 'tenant-b')).toThrow(
        ForbiddenException,
      );
    });

    it('leaves the where clause unscoped for a platform-wide super admin query', () => {
      const where = scopeByTenant(superAdmin, { isActive: true });
      expect(where).toEqual({ isActive: true });
      expect(where).not.toHaveProperty('tenantId');
    });
  });
});
