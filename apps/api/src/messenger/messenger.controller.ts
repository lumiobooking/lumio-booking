import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MessengerService } from './messenger.service';
import { HandoffDto, UpdateMessengerDto } from './dto/messenger.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

/** Salon-admin management of the Messenger booking bot (tenant-scoped). */
@Roles(UserRole.SALON_ADMIN)
@Controller('messenger')
export class MessengerController {
  constructor(private readonly svc: MessengerService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.get(user);
  }

  @Get('connect')
  connect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.oauthUrl(user);
  }

  @Post('settings')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMessengerDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disconnect(user);
  }

  @Get('threads')
  threads(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listThreads(user);
  }

  @Post('threads/:id/handoff')
  handoff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: HandoffDto) {
    return this.svc.setHandoff(user, id, dto.handoff ?? true);
  }
}
