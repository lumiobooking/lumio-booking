import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PayrollService } from './payroll.service';
import { GoalDto } from './dto';

/**
 * A technician's own pay, in her app (/staff/pay). STAFF logins only; the
 * service finds her staff record by her login and returns HER line alone.
 */
@Roles(UserRole.STAFF)
@Controller('my-pay')
export class MyPayController {
  constructor(private readonly payroll: PayrollService) {}

  /** Her private week / month targets and where she stands. Hers alone. */
  @Get('goals')
  goals(@CurrentUser() user: AuthenticatedUser) { return this.payroll.myGoals(user); }

  @Patch('goals')
  saveGoals(@CurrentUser() user: AuthenticatedUser, @Body() body: GoalDto) { return this.payroll.saveMyGoals(user, body); }

  /** Her closed payslips of one year, added up — the statement she prints. Declared before the catch-all. */
  @Get('year')
  year(@CurrentUser() user: AuthenticatedUser, @Query('year') year?: string) {
    return this.payroll.myYear(user, year);
  }

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.payroll.mySlip(user, from, to);
  }
}
