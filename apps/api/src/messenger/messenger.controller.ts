import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MessengerService } from './messenger.service';
import { HandoffDto, LeadStatusDto, RenameThreadDto, SendTestDto, UpdateMessengerDto } from './dto/messenger.dto';
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

  /** Multi-page OAuth: the parked page list to pick from (names only). */
  @Get('oauth/candidates')
  candidates(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.oauthCandidates(user);
  }

  @Post('oauth/choose')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  choose(@CurrentUser() user: AuthenticatedUser, @Body() dto: { pageId?: string }) {
    return this.svc.oauthChoose(user, String(dto?.pageId || ''));
  }

  @Post('settings')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMessengerDto) {
    return this.svc.updateSettings(user, dto);
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser, @Body() dto: { pageId?: string }) {
    return this.svc.disconnect(user, dto?.pageId ? String(dto.pageId) : undefined);
  }

  @Get('threads')
  threads(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listThreads(user);
  }

  @Post('threads/:id/handoff')
  handoff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: HandoffDto) {
    return this.svc.setHandoff(user, id, dto.handoff ?? true);
  }

  @Post('threads/:id/rename')
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RenameThreadDto) {
    return this.svc.renameThread(user, id, dto.name);
  }

  /** Read the salon's website or connected Page and propose Bot-facts rows. */
  @Post('import-facts')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  importFacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: { source?: string; url?: string; text?: string }) {
    return this.svc.importFacts(user, dto || {});
  }

  // ---- Sales-mode leads (agency page) ------------------------------------

  @Get('leads')
  leads(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listLeads(user);
  }

  @Post('leads/:id/status')
  leadStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: LeadStatusDto) {
    return this.svc.setLeadStatus(user, id, dto.status);
  }

  @Get('webhook-status')
  webhookStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.webhookStatus(user);
  }

  @Get('activity')
  activity(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.activity(user);
  }

  @Post('send')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendTestDto) {
    return this.svc.sendManual(user, dto.threadId, dto.text);
  }

  @Post('clear-review-data')
  clearReviewData(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.clearReviewData(user);
  }

  @Post('clear-conversations')
  clearConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.clearAllConversations(user);
  }
}
