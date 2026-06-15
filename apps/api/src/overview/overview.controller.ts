import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OverviewService } from './overview.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.stats(user);
  }

  // GET /api/overview/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
  @Get('dashboard')
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.overview.dashboard(user, from, to);
  }
}
