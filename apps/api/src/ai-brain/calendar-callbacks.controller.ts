import { Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { AiBrainService } from './ai-brain.service';

/**
 * "Cần gọi lại" on the Calendar: the callbacks the AI promised (hotline,
 * chat), for whoever runs the desk — the calendar capability, not the AI
 * page's marketing one. Tenant-scoped in the service.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('calendar')
@Controller('calendar-callbacks')
export class CalendarCallbacksController {
  constructor(private readonly brain: AiBrainService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.brain.deskCallbacks(user); }

  @Patch(':id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.brain.doneCallback(user, id, true); }
}
