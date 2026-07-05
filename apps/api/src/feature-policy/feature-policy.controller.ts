import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FeaturePolicyService } from './feature-policy.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/** Salon-side: read the resolved policy so the UI can hide locked features. */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('feature-policy')
export class FeaturePolicyController {
  constructor(private readonly svc: FeaturePolicyService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getForSalon(user);
  }
}

/** Super Admin: view + set which features a salon may self-manage. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/feature-policy')
export class FeaturePolicyAdminController {
  constructor(private readonly svc: FeaturePolicyService) {}

  @Get(':tenantId')
  get(@Param('tenantId') tenantId: string) {
    return this.svc.getForTenant(tenantId);
  }

  @Post()
  set(@Body() dto: { tenantId: string; policy: Record<string, unknown> }) {
    return this.svc.setForTenant(dto?.tenantId, dto?.policy || {});
  }
}
