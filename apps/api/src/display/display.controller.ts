import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DisplayService } from './display.service';
import { PushStateDto } from './dto/display.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Register-side endpoints. Authenticated as the salon (SALON_ADMIN or POS staff);
// the tenant is always taken from the JWT, so a salon can only touch its OWN display.
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('display')
export class DisplayController {
  constructor(private readonly display: DisplayService) {}

  @Get('session')
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.display.getSession(user);
  }

  @Post('session/rotate')
  rotate(@CurrentUser() user: AuthenticatedUser) {
    return this.display.rotate(user);
  }

  @Post('push')
  push(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushStateDto) {
    return this.display.pushState(user, dto.state, dto.payTicket);
  }
}
