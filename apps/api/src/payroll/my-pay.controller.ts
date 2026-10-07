import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PayrollService } from './payroll.service';

/**
 * A technician's own pay, in her app (/staff/pay). STAFF logins only; the
 * service finds her staff record by her login and returns HER line alone.
 */
@Roles(UserRole.STAFF)
@Controller('my-pay')
export class MyPayController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.payroll.mySlip(user, from, to);
  }
}
