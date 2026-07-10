import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StatsService } from './stats.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Customers (appointments by channel + walk-ins) and revenue by source. */
  @Get('sources')
  sources(
    @CurrentUser() user: AuthenticatedUser,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stats.sources(user, bucket, from, to);
  }
}
