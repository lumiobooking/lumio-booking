import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CalendarLayoutService } from './calendar-layout.service';

/**
 * GET / PATCH /api/calendar-layout/staff — the order of the technician columns
 * and who is hidden, for the caller's salon only (tenant from the token).
 * Reading: anyone who opens the calendar. Saving: owner or manager (service).
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('calendar', 'bookings', 'walkins', 'pos')
@Controller('calendar-layout')
export class CalendarLayoutController {
  constructor(private readonly layout: CalendarLayoutService) {}

  @Get('staff')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.layout.get(user);
  }

  @Patch('staff')
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: { order?: string[]; hidden?: string[] }) {
    return this.layout.save(user, dto);
  }
}
