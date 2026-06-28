import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { BranchesService } from './branches.service';

/** Multi-branch (chain) endpoints for the branch switcher + consolidated report. */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Branches this user may switch between (empty + canSwitch:false for single-salon). */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.branches.listForUser(user);
  }

  /** Consolidated revenue across the user's branches. Revenue data → reports capability. */
  @Get('report')
  @Caps('reports')
  report(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.branches.chainReport(user, from, to);
  }
}
