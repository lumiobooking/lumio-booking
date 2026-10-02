import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PayrollService } from './payroll.service';
import { FinalizeDto, PayrollSettingsDto, SaveOverrideDto } from './dto';

// Pay is the owner's business: salon admins (and managers granted the
// payroll capability) only. The tenant always comes from the token.
@Roles(UserRole.SALON_ADMIN)
@Caps('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.payroll.getSettings(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: PayrollSettingsDto) {
    return this.payroll.updateSettings(user, dto);
  }

  // GET /api/payroll?from=YYYY-MM-DD&to=YYYY-MM-DD — default: the current pay period.
  @Get()
  preview(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.payroll.preview(user, from, to);
  }

  @Patch('override')
  saveOverride(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveOverrideDto) {
    return this.payroll.saveOverride(user, dto);
  }

  @Post('finalize')
  @HttpCode(200)
  finalize(@CurrentUser() user: AuthenticatedUser, @Body() dto: FinalizeDto) {
    return this.payroll.finalize(user, dto);
  }

  @Post('runs/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payroll.reopen(user, id);
  }
}
