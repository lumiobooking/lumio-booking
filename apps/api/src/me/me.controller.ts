import { BadRequestException, Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { hashSecret, verifySecret } from '../auth/password.util';

/**
 * Demonstration of tenant-scoped + role-protected endpoints. Real feature
 * modules (services, staff, bookings) follow the exact same pattern in later
 * steps.
 */
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  // GET /api/me/tenant -> the salon a SALON_ADMIN/STAFF belongs to.
  // SUPER_ADMIN has no tenant, so this is restricted to salon-side roles.
  @Get('tenant')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  async myTenant(@CurrentUser() user: AuthenticatedUser) {
    // The Tenant table is the root entity, so its own `id` IS the tenant id
    // (there is no `tenantId` column here). resolveTenantScope returns the
    // caller's own tenantId, so a salon user can only ever read their own
    // salon record through this route.
    const tenantId = resolveTenantScope(user);
    if (!tenantId) {
      return null;
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true, timezone: true },
    });
    return tenant;
  }

  // GET /api/me/plan -> the salon's plan feature flags (for UI gating).
  // No plan assigned → full access so nothing breaks for un-planned salons.
  @Get('plan')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  async myPlan(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: {
          select: { name: true, posEnabled: true, onlinePaymentEnabled: true, multiLocationEnabled: true, whiteLabelEnabled: true },
        },
      },
    });
    const p = tenant?.plan;
    return {
      planName: p?.name ?? null,
      posEnabled: p ? p.posEnabled : true,
      onlinePaymentEnabled: p ? p.onlinePaymentEnabled : true,
      multiLocationEnabled: p ? p.multiLocationEnabled : true,
      whiteLabelEnabled: p ? p.whiteLabelEnabled : true,
    };
  }

  // PATCH /api/me/account -> the signed-in user changes their OWN login email
  // and/or password. Works for any role (Super Admin, Salon Admin, Staff).
  // Current password is required to authorise the change.
  @Patch('account')
  async updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { currentPassword?: string; newEmail?: string; newPassword?: string },
  ) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!u) throw new NotFoundException('Account not found');
    if (!dto.currentPassword || !(await verifySecret(dto.currentPassword, u.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const data: { email?: string; passwordHash?: string; passwordChangedAt?: Date } = {};
    if (dto.newEmail && dto.newEmail.trim() && dto.newEmail.trim() !== u.email) {
      data.email = dto.newEmail.trim().toLowerCase();
    }
    if (dto.newPassword) {
      if (dto.newPassword.length < 8) throw new BadRequestException('New password must be at least 8 characters');
      data.passwordHash = await hashSecret(dto.newPassword);
      data.passwordChangedAt = new Date(); // invalidates all existing sessions
    }
    if (!data.email && !data.passwordHash) {
      throw new BadRequestException('Nothing to change — enter a new email or new password');
    }
    try {
      await this.prisma.user.update({ where: { id: u.id }, data });
    } catch {
      throw new BadRequestException('That email is already in use by another account');
    }
    // passwordChanged tells the client to log out immediately and re-login.
    return { ok: true, email: data.email ?? u.email, passwordChanged: !!data.passwordHash };
  }
}
