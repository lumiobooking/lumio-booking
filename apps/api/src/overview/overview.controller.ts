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

  // GET /api/overview/home?from=YYYY-MM-DD&to=YYYY-MM-DD — the owner's home
  // screen: the dashboard numbers, the previous period, and the floor right now.
  @Get('home')
  home(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.overview.home(user, from, to);
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
