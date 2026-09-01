import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ContentService } from './content.service';
import { ContentChatService } from './content-chat.service';
import { SocialPublishService } from './social-publish.service';
import { ContentAdminService } from './content-admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { EditWeekDto } from './dto/edit-week.dto';
import { SendChatDto } from './dto/chat.dto';
import { SavePostDto } from './dto/save-post.dto';

/**
 * What a salon can reach: today's approved plan, and marking it done.
 *
 * Scoped to the caller's tenant on every route — a salon can never read
 * another salon's plan, and never sees a draft the Lumio team has not
 * released.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('content')
export class ContentController {
  constructor(
    private readonly svc: ContentService,
    private readonly chat: ContentChatService,
    private readonly publisher: SocialPublishService,
  ) {}

  // ---- scheduled posting to the salon's OWN Page and Instagram -------------
  // Every route is scoped to the caller's tenant inside the service, and the
  // page published to is looked up FROM that tenant: publishing to another
  // salon's Facebook Page would be a public, permanent mistake.

  /** The queue, plus whether each waiting post can still actually be sent. */
  @Get('posts')
  listPosts(@CurrentUser() user: AuthenticatedUser) {
    return this.publisher.list(user);
  }

  /** Create or edit a queued post. Saving as 'scheduled' validates it first. */
  @Post('posts')
  savePost(@CurrentUser() user: AuthenticatedUser, @Body() body: SavePostDto) {
    return this.publisher.save(user, body);
  }

  /** Move one post to another slot — the drag on the month calendar. */
  @Patch('posts/:id/when')
  reschedulePost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
  ) {
    return this.publisher.reschedule(user, id, body?.scheduledAt);
  }

  @Delete('posts/:id')
  cancelPost(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publisher.cancel(user, id);
  }

  /**
   * Take it off the calendar for good.
   *
   * Separate from cancel: cancel stops a post going out and keeps the row,
   * this erases the row. For an already-published post it removes LUMIO's
   * record only — what is on Facebook stays on Facebook, and the screen says so
   * before the press.
   */
  @Delete('posts/:id/remove')
  removePost(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publisher.remove(user, id);
  }

  /** Send one right now, instead of waiting for its slot. */
  @Post('posts/:id/publish')
  publishPost(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publisher.publishNow(user, id);
  }

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    return this.svc.forSalon(user, date);
  }

  /** Upcoming events + the discount advice, computed from this salon's book. */
  @Get('plan')
  plan(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.planFor(user);
  }

  /**
   * Redraft today's ideas now instead of waiting for the 6am run.
   *
   * Capped per tenant per day inside the service — every press costs a real API
   * call, and a button with no ceiling is a bill with no ceiling.
   */
  /** Every week this salon has on file — the archive the plan used to lack. */
  @Get('weeks')
  weeks(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.weekHistory(user);
  }

  /** One archived week, read as the team left it. */
  @Get('weeks/:key')
  weekAt(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.svc.weekAt(user, key);
  }

  /**
   * The Lumio team rewrites a week before handing it over.
   *
   * The support-session check is inside the service, not on this decorator: the
   * route has to stay reachable by a SALON_ADMIN token, because that is exactly
   * what a support session carries. Putting the gate in the controller would
   * have made it a role check, which is the wrong question.
   */
  @Patch('weeks/:key')
  editWeek(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: EditWeekDto,
  ) {
    return this.svc.editWeek(user, key, dto);
  }

  // ---- team ↔ salon, about the work --------------------------------------
  //
  // Both sides reach the same routes. Which side WROTE a message is decided at
  // write time from the session and stored, because a support token carries a
  // SALON_ADMIN role and deriving the side at read time would recolour history.

  /** One thread: the shared window, or the comments under one item. */
  @Get('chat')
  chatList(
    @CurrentUser() user: AuthenticatedUser,
    @Query('subject') subject?: string,
    @Query('before') before?: string,
  ) {
    return this.chat.list(user, subject ?? 'general', before);
  }

  /** Close a settled thread, or take it. Team side only (checked in the service). */
  @Patch('chat/state')
  chatState(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { subject: string; resolved?: boolean; assignToMe?: boolean },
  ) {
    return this.chat.setThreadState(user, dto?.subject, dto ?? {});
  }

  /** Unread counts per subject, so the dot lands on the item being discussed. */
  @Get('chat/unread')
  chatUnread(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.unread(user);
  }

  @Post('chat')
  chatSend(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendChatDto) {
    return this.chat.send(user, dto.subject, dto.body);
  }

  @Post('refresh')
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.refreshFor(user);
  }

  /**
   * Read the business's own website and Facebook Page and propose the profile.
   *
   * Drafts only. Everything downstream — content, ad targeting, what the
   * hotline says to a customer — is derived from these sentences, so a model's
   * reading of a marketing page is a proposal to correct, not a fact to act on.
   */
  @Post('profile/scan')
  scanProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto?: { note?: string }) {
    return this.svc.scanProfile(user, { note: dto?.note });
  }

  /**
   * The language the AI writes this salon's plan in.
   *
   * Separate from the interface language on purpose: a Vietnamese owner running
   * a salon in Texas wants the plan explained in Vietnamese and the captions
   * written in English, because her customers are American. One toggle cannot
   * serve both, so there are two.
   */
  @Patch('language')
  setLanguage(@CurrentUser() user: AuthenticatedUser, @Body() dto: { lang?: string }) {
    return this.svc.setContentLang(user, dto?.lang);
  }

  @Post('ideas/:id/status')
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { status: string; resultNote?: string; postedUrl?: string },
  ) {
    return this.svc.setIdeaStatus(user, id, dto?.status, dto?.resultNote, dto?.postedUrl);
  }

  /**
   * The salon accepting the week the team wrote.
   *
   * Deliberately the SALON's action, and the mirror of editing being the
   * team's: the team proposes, the client agrees. A plan nobody agreed to is a
   * document, not a commitment, and an agency that cannot point at the moment
   * of agreement is an agency arguing about scope in month three.
   */
  @Post('weeks/:key/approve')
  approveWeek(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.svc.approveWeek(user, key);
  }
}

/** The Lumio team's console: the library, the week's notes, the review queue. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/content')
export class ContentAdminController {
  constructor(
    private readonly admin: ContentAdminService,
    private readonly svc: ContentService,
    private readonly chat: ContentChatService,
  ) {}

  /**
   * Every conversation across every salon — the team's working queue.
   *
   * Without this the only door is one salon's own page, so covering forty
   * salons would mean opening forty pages to find the three that wrote in.
   * Nobody does that twice, and a channel the client was told to use but that
   * nobody answers is worse than one never offered.
   */
  @Get('inbox')
  inbox(@CurrentUser() user: AuthenticatedUser, @Query('filter') filter?: string) {
    const f = filter === 'mine' || filter === 'all' || filter === 'open' ? filter : 'waiting';
    return this.chat.inbox(f, user.userId);
  }

  @Get('inbox/:tenantId')
  inboxThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tenantId') tenantId: string,
    @Query('subject') subject?: string,
  ) {
    return this.chat.inboxThread(tenantId, subject ?? 'general', user);
  }

  /** Close a settled thread from the console, or reopen it. */
  @Patch('inbox/:tenantId/state')
  inboxState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tenantId') tenantId: string,
    @Body() dto: { subject: string; resolved?: boolean; assignToMe?: boolean },
  ) {
    return this.chat.setThreadState(
      { ...user, tenantId, supportSession: true },
      dto?.subject,
      dto ?? {},
    );
  }

  @Post('inbox/:tenantId')
  inboxReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tenantId') tenantId: string,
    @Body() dto: SendChatDto,
  ) {
    return this.chat.inboxReply(tenantId, dto.subject, dto.body, user);
  }

  // format library
  @Get('formats')
  formats(@Query('industry') industry?: string) {
    return this.admin.listFormats(industry);
  }

  @Post('formats')
  saveFormat(@Body() dto: never) {
    return this.admin.saveFormat(dto);
  }

  @Post('formats/seed')
  seedFormats(@Body() dto: { industry?: string }) {
    return this.admin.seedFormats(dto?.industry ?? 'SALON');
  }

  @Delete('formats/:id')
  removeFormat(@Param('id') id: string) {
    return this.admin.deleteFormat(id);
  }

  /**
   * Read every tenant's own data and list what its setup is missing.
   *
   * The answer to "why does every client look like a nail salon": each tenant
   * defaults to SALON, and nothing on any screen said so. This reads the
   * services, menus and tables each shop already recorded and reports the
   * mismatch, with the evidence quoted.
   */
  @Get('scan')
  scan() {
    return this.admin.scanTenants();
  }

  /** Apply one detected industry, after a person has read the evidence. */
  @Post('scan/apply')
  applyIndustry(@Body() dto: { tenantId: string; industry: string }) {
    return this.admin.applyIndustry(dto?.tenantId, dto?.industry);
  }

  // weekly trend notes
  @Get('notes')
  notes(@Query('industry') industry?: string) {
    return this.admin.listNotes(industry);
  }

  @Post('notes')
  saveNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: never) {
    return this.admin.saveNote(user, dto);
  }

  @Delete('notes/:id')
  removeNote(@Param('id') id: string) {
    return this.admin.deleteNote(id);
  }

  // review queue
  @Get('queue')
  queue(@Query('date') date?: string) {
    return this.admin.queue(date);
  }

  @Post('ideas/:id')
  edit(@Param('id') id: string, @Body() dto: never) {
    return this.admin.editIdea(id, dto);
  }

  @Post('publish')
  publish(@Body() dto: { ids?: string[]; forDate?: string; tenantId?: string }) {
    return this.admin.publish(dto ?? {});
  }

  @Post('discard')
  discard(@Body() dto: { ids: string[] }) {
    return this.admin.discard(dto?.ids ?? []);
  }

  /** Draft now instead of waiting for tomorrow's 6am run. */
  @Post('generate')
  generate(@Body() dto: { tenantId?: string; industry?: string; force?: boolean }) {
    if (dto?.tenantId) return this.svc.generateForTenant(dto.tenantId, { force: dto.force });
    return this.svc.generateAll(dto?.industry || null);
  }

  /**
   * Census diagnostic.
   *
   * The area figures come from an API this code was written against without
   * being able to call it. When it misbehaves, this returns the raw reason the
   * server gave rather than leaving anyone to guess which of the year, the
   * variable codes or the network is wrong.
   */
  @Get('census/:tenantId')
  census(@Param('tenantId') tenantId: string, @Query('zips') zips?: string, @Query('force') force?: string) {
    return this.svc.gather(tenantId).then((c) =>
      this.svc.areaFor(tenantId, zips?.trim() || c.nearbyZips, { force: force === '1' }));
  }

  /** The raw signal profile behind a salon's ideas — for spot-checking. */
  @Get('signals/:tenantId')
  signals(@Param('tenantId') tenantId: string) {
    return this.svc.gather(tenantId).then((c) => ({
      tenantName: c.tenantName, industry: c.industry, city: c.city,
      signals: c.signals, revenue: c.revenue,
    }));
  }
}
