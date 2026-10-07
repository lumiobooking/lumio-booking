import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { TimeClockService } from './time-clock.service';
import { ClockEditDto, ClockEntryDto } from './dto';

/** Chấm công. A technician's own clock (me/*); the owner's view and corrections (the rest). */
@Controller('time-clock')
export class TimeClockController {
  constructor(private readonly clock: TimeClockService) {}

  @Roles(UserRole.STAFF)
  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) { return this.clock.mine(user); }

  @Roles(UserRole.STAFF)
  @Post('me/in')
  @HttpCode(200)
  clockIn(@CurrentUser() user: AuthenticatedUser) { return this.clock.clockIn(user); }

  @Roles(UserRole.STAFF)
  @Post('me/out')
  @HttpCode(200)
  clockOut(@CurrentUser() user: AuthenticatedUser) { return this.clock.clockOut(user); }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('payroll')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) { return this.clock.list(user, from, to); }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('payroll')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClockEntryDto) { return this.clock.create(user, dto); }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('payroll')
  @Patch(':id')
  edit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ClockEditDto) { return this.clock.edit(user, id, dto); }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('payroll')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.clock.remove(user, id); }
}
