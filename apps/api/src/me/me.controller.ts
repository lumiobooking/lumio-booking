import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

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
}
