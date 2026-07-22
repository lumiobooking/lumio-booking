import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { MarketingService } from './marketing.service';

/**
 * Marketing reporting. Salon admins see their own salon; a super admin (the
 * agency) may pass ?tenantId= to view any client. Read-only in Phase 0.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.marketing.overview(user, from, to, tenantId);
  }
}
