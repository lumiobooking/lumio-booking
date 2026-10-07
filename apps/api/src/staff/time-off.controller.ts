import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { TimeOffService } from './time-off.service';
import { TimeOffCreateDto, TimeOffDecisionDto, TimeOffRequestDto } from './dto/time-off.dto';

/** Nghỉ phép. A technician's own requests (me/*); the owner's list and decisions (the rest). */
@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOff: TimeOffService) {}

  @Roles(UserRole.STAFF)
  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) { return this.timeOff.mine(user); }

  @Roles(UserRole.STAFF)
  @Post('me')
  request(@CurrentUser() user: AuthenticatedUser, @Body() dto: TimeOffRequestDto) { return this.timeOff.request(user, dto); }

  @Roles(UserRole.STAFF)
  @Delete('me/:id')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.timeOff.cancel(user, id); }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeOff.list(user, { status, from, to });
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TimeOffCreateDto) { return this.timeOff.create(user, dto); }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  @Patch(':id')
  decide(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: TimeOffDecisionDto) { return this.timeOff.decide(user, id, dto.decision, dto.note); }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.timeOff.remove(user, id); }
}
