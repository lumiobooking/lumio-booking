import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SquarePosService } from './square-pos.service';

/**
 * Square POS sync for the signed-in salon. Owner-level only: it reads the
 * salon's Square sales and writes tickets. Under `payments-hub/` so a support
 * session sees it only with the payments capability (support-scope.ts).
 */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@Controller('payments-hub/square-pos')
export class SquarePosController {
  constructor(private readonly sync: SquarePosService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.status(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: { enabled?: unknown; since?: unknown; staffMap?: unknown; pushCustomers?: unknown }) {
    return this.sync.update(user, dto ?? {});
  }

  @Post('sync')
  syncNow(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.syncNow(user);
  }

  @Post('push-menu')
  pushMenu(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.pushMenu(user);
  }
}
