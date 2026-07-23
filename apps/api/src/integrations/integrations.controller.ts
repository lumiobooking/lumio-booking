import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { IntegrationsService } from './integrations.service';

/** Read-only aggregate of every third-party connection for ONE salon. */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }
}
