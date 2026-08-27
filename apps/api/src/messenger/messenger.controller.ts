import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { MessengerService } from './messenger.service';
import { InboxEventsService } from './inbox-events.service';
import { HandoffDto, LeadStatusDto, RenameThreadDto, SendTestDto, SuggestGreetingDto, UpdateMessengerDto } from './dto/messenger.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

/** Salon-admin management of the Messenger booking bot (tenant-scoped). */
@Roles(UserRole.SALON_ADMIN)
@Controller('messenger')
export class MessengerController {
  constructor(
    private readonly svc: MessengerService,
    private readonly events: InboxEventsService,
  ) {}

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

  /**
   * Live inbox stream (Server-Sent Events).
   *
   * The browser opens this once and holds it. When a customer writes, the
   * webhook publishes and this pushes a one-word nudge; the page then refetches
   * through the normal tenant-scoped endpoints. NOTHING about the message
   * travels down this pipe — no text, no name, no id — because a long-lived
   * connection is the easiest place in a system to leak one salon's data onto
   * another salon's screen, and a bare nudge makes that impossible rather than
   * merely unlikely.
   *
   * Authenticated by the normal guard on this controller, so the token arrives
   * in the Authorization header like every other request. That is why the page
   * reads this with fetch() and a stream reader rather than EventSource:
   * EventSource cannot set headers, which would have forced the token into the
   * query string, and query strings end up in access logs.
   */
  @Get('stream')
  stream(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Render and most proxies buffer responses by default, which would hold
    // every event until the connection closed — the exact opposite of the point.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const tenantId = user.tenantId ?? '';
    if (!tenantId) { res.end(); return; }

    res.write('event: ready\ndata: 1\n\n');
    const off = this.events.subscribe(tenantId, (kind) => {
      res.write(`event: ${kind}\ndata: 1\n\n`);
    });

    // A comment line every 25s. Proxies and load balancers close a connection
    // that has been silent too long, and a stream that dies quietly is worse
    // than no stream: the page would look live and be frozen.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    const close = () => { clearInterval(ping); off(); res.end(); };
    req.on('close', close);
    req.on('error', close);
  }

  /** One conversation in full, plus what the salon knows about this customer. */
  @Get('threads/:id')
  thread(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getThread(user, id);
  }

  /**
   * The customer's real profile picture, streamed through us.
   *
   * The Page token never leaves the server — see the service. 204 rather than
   * 404 when Meta withholds one, because "there is no picture" is a normal
   * answer here, not an error, and the inbox draws initials instead.
   */
  @Get('threads/:id/avatar')
  async avatar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const img = await this.svc.threadAvatar(user, id);
    if (!img) { res.status(204).end(); return; }
    res.setHeader('Content-Type', img.contentType);
    // Private: this is one salon's customer, and a shared cache must never hand
    // it to another tenant's browser.
    res.setHeader('Cache-Control', 'private, max-age=21600');
    res.end(img.body);
  }

  /**
   * Internal notes. Nothing here reaches Meta or the customer — see the service.
   */
  @Post('threads/:id/notes')
  addNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { text?: string }) {
    return this.svc.addNote(user, id, String(dto?.text ?? ''));
  }

  @Post('threads/:id/notes/:noteId/delete')
  deleteNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.svc.deleteNote(user, id, noteId);
  }

  // ---- Labels and follow-ups ----------------------------------------------

  @Get('labels')
  labels(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listLabels(user);
  }

  @Post('labels')
  createLabel(@CurrentUser() user: AuthenticatedUser, @Body() dto: { name?: string; color?: string }) {
    return this.svc.createLabel(user, String(dto?.name ?? ''), String(dto?.color ?? ''));
  }

  @Post('labels/:labelId/delete')
  deleteLabel(@CurrentUser() user: AuthenticatedUser, @Param('labelId') labelId: string) {
    return this.svc.deleteLabel(user, labelId);
  }

  @Post('threads/:id/labels')
  setLabel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { labelId?: string; on?: boolean }) {
    return this.svc.setThreadLabel(user, id, String(dto?.labelId ?? ''), dto?.on !== false);
  }

  /** A date, not a label — a label cannot go overdue. See the service. */
  @Post('threads/:id/followup')
  followUp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { at?: string | null; note?: string | null }) {
    return this.svc.setFollowUp(user, id, dto?.at ?? null, dto?.note ?? null);
  }

  /** Close a conversation. A new customer message reopens it automatically. */
  @Post('threads/:id/status')
  threadStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { status?: string }) {
    return this.svc.setThreadStatus(user, id, dto?.status === 'done' ? 'done' : 'open');
  }

  /** Opening a conversation in the inbox clears its unread mark. */
  @Post('threads/:id/read')
  threadRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.markThreadRead(user, id);
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

  @Post('suggest-greeting')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  suggestGreeting(@CurrentUser() user: AuthenticatedUser, @Body() dto: SuggestGreetingDto) {
    return this.svc.suggestGreeting(user, dto || {});
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
