import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ContentService } from './content.service';
import { ContentChatService } from './content-chat.service';
import { SocialPublishService } from './social-publish.service';
import { ContentAdminService } from './content-admin.service';
import { TrendFeedService } from './trends/trend-feed.service';
import { PostReviewService } from './post-review.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { EditWeekDto } from './dto/edit-week.dto';
import { SuggestionsService } from './suggestions.service';
import { clientWeek, flattenForClient } from './client-view';
import { SendChatDto } from './dto/chat.dto';
import { SavePostDto, SetStageDto } from './dto/save-post.dto';

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
    private readonly trends: TrendFeedService,
    private readonly review: PostReviewService,
    private readonly suggestions: SuggestionsService,
  ) {}

  // ---- the salon's approval screen (the logged-in door) --------------------
  // The client-safe shape: scheduled + recently-posted posts only, one-tap
  // approve. Comments ride the existing /content/chat routes (subject post:x).

  /**
   * The opening assessment for one salon.
   *
   * Read-only and computed on every request rather than cached: a report that
   * shows yesterday's coverage while someone is in the middle of connecting the
   * Google profile is a report that tells them their work did nothing.
   */
  @Get('onboarding')
  onboarding(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.onboardingReport(user);
  }

  // ---- Google Maps roadmap ----
  // Salon-side and read-mostly: the owner (or the Lumio team on their behalf)
  // walks the list. Ticking is deliberately per-task rather than a bulk save,
  // so two people working the same board cannot overwrite each other.

  @Get('seo-roadmap')
  seoRoadmap(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.seoRoadmap(user);
  }

  @Post('seo-tier')
  setSeoTier(@CurrentUser() user: AuthenticatedUser, @Body() dto?: { tier?: string }) {
    return this.svc.setSeoTier(user, dto?.tier);
  }

  @Post('seo-roadmap/:taskId')
  setSeoTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body() dto?: { done?: boolean },
  ) {
    return this.svc.setSeoTask(user, taskId, dto?.done !== false);
  }

  @Get('review')
  reviewFeed(@CurrentUser() user: AuthenticatedUser) {
    return this.review.feedFor(user);
  }

  // ---- the salon's own screen ---------------------------------------------
  //
  // Everything under here is built for the shop, not filtered for it. The
  // difference matters: the team's payload carries the method — which feeds get
  // read, why the filming day is the filming day, the five-stage path — and a
  // salon's login is one shared password away from a competitor. See
  // client-view.ts, which rebuilds these shapes from scratch.

  /**
   * This week, as the shop's own to-do list.
   *
   * The shop's physical work only: what to film, what to photograph, what to
   * ask for at the counter. No posting days, no posting times, no reasoning,
   * no stage, no numbers the week was decided from.
   */
  @Get('my-week')
  async myWeek(@CurrentUser() user: AuthenticatedUser, @Query('lang') lang?: string) {
    // A week is generated for every tenant on the platform whether or not
    // anybody is running its marketing. Handing homework to a shop that bought
    // a booking system and nothing else is worse than showing it nothing, so
    // the plan appears only once there is evidence the team is on this salon.
    if (!(await this.suggestions.hasAgencyWork(user))) return { week: null, weekKey: null, lastWeek: null };
    const [{ plan, weekKey, ticks, auto }, lastWeek, ads] = await Promise.all([
      this.svc.weekForSalonKept(user),
      this.svc.lastWeekForSalon(user).catch(() => null),
      this.svc.adsReceiptForSalon(user).catch(() => null),
    ]);
    // One slot, two states: the receipt when money is going out, the offer
    // when it is not. Never both — a busy owner skims a screen that argues
    // with itself.
    const adsPlan = ads ? null : await this.svc.adsPitchForSalon(user).catch(() => null);
    return {
      week: flattenForClient(clientWeek(plan, { weekKey: weekKey ?? '', ticks, auto }), lang === 'en' ? 'en' : 'vi'),
      weekKey,
      // What the salon GOT last week — its own numbers, and the first thing
      // its screen shows. See ContentService.lastWeekForSalon.
      lastWeek: lastWeek ? flattenForClient(lastWeek, lang === 'en' ? 'en' : 'vi') : null,
      // Where the ad money went and what came back. Rebuilt field by field in
      // ads-receipt; null in a month with no spend, which is not a result.
      ads: ads ? flattenForClient(ads, lang === 'en' ? 'en' : 'vi') : null,
      adsPlan: adsPlan ? flattenForClient(adsPlan, lang === 'en' ? 'en' : 'vi') : null,
    };
  }

  /**
   * The shop rewriting its own week — reword a job, move it, drop it, add
   * one of its own. Same sanitiser as the team's edit; see shop-week-edit
   * for what the shop can and cannot reach.
   */
  @Patch('my-week')
  editMyWeek(@CurrentUser() user: AuthenticatedUser, @Body() dto: { lang?: string; jobs?: unknown; add?: unknown }) {
    return this.svc.editWeekAsShop(user, {
      lang: dto?.lang,
      jobs: Array.isArray(dto?.jobs) ? (dto.jobs as never[]) : [],
      add: Array.isArray(dto?.add) ? (dto.add as never[]) : [],
    });
  }

  /** The holidays ahead, each with one programme the shop can say yes to. */
  @Get('my-holidays')
  async myHolidays(@CurrentUser() user: AuthenticatedUser, @Query('lang') lang?: string) {
    if (!(await this.suggestions.hasAgencyWork(user))) return { ideas: [] };
    const ideas = await this.svc.holidayIdeasFor(user);
    // Rebuilt field by field, the same discipline as the week: the shop gets
    // the date, the programme and the window, and nothing about the calendar
    // the team keeps or the margin arithmetic behind the number.
    const safe = ideas.map((i) => ({
      key: i.key, name: i.name, date: i.date, daysAway: i.daysAway, spanDays: i.spanDays, idea: i.idea, window: i.window,
      offer: { kind: i.offer.kind, value: i.offer.value, gift: i.offer.gift, slot: i.offer.slot, expires: i.offer.expires, terms: i.offer.terms },
    }));
    return { ideas: flattenForClient(safe, lang === 'en' ? 'en' : 'vi') };
  }

  /**
   * The shop saying yes to the suggested ad budget. Files the exact line the
   * pitch quoted, so what the team reads is what the owner agreed to.
   */
  @Post('my-ads/approve')
  @HttpCode(200)
  async approveAds(@CurrentUser() user: AuthenticatedUser) {
    const pitch = await this.svc.adsPitchForSalon(user);
    if (!pitch?.request) throw new BadRequestException('Chưa có đề xuất ngân sách nào để duyệt.');
    // File WHAT was agreed, not only that it was. The card promises a review on
    // day 7 and day 14; without a record there is no day 7 to be seven days
    // into, which is why that promise had never once been kept.
    await this.svc.approveAdsCampaign(user);
    return this.suggestions.requestFromShop(user, pitch.request);
  }

  // ---- the campaign the shop agreed to, and the reviews it owes ----
  // Team-side. The salon never calls these: it approved the budget and is, by
  // the terms of the deal, not the one watching the campaign.

  /** A person switched the campaign on. Every review date counts from here. */
  @Post('ads-campaign/start')
  @HttpCode(200)
  startCampaign(@CurrentUser() user: AuthenticatedUser, @Body() dto?: { on?: unknown }) {
    return this.svc.startAdsCampaign(user, typeof dto?.on === 'string' ? dto.on : undefined);
  }

  /** A review was sent, and what was changed because of it. */
  @Post('ads-campaign/review/:day')
  @HttpCode(200)
  markReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('day') day: string,
    @Body() dto?: { note?: unknown },
  ) {
    return this.svc.markAdsReview(user, day, dto?.note);
  }

  /** "Run this one": a holiday programme by key, or one in the shop's own words. Lands in the team's inbox. */
  @Post('my-holidays/request')
  @HttpCode(200)
  async requestOffer(@CurrentUser() user: AuthenticatedUser, @Body() dto: { key?: unknown; text?: unknown }) {
    const line = await this.svc.offerRequestLine(user, dto ?? {});
    return this.suggestions.requestFromShop(user, line);
  }

  /** What the team has asked this shop to film, and what it has sent back. */
  @Get('suggestions')
  mySuggestions(@CurrentUser() user: AuthenticatedUser) {
    return this.suggestions.listForSalon(user);
  }

  /** The shop filmed it and is sending the files. Either side may close a card. */
  @Post('suggestions/:id/done')
  @HttpCode(200)
  suggestionDone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { media?: unknown },
  ) {
    return this.suggestions.markDone(user, id, dto?.media);
  }

  /** The shop sends files nobody asked for — a card it opens and closes itself. */
  @Post('suggestions/shop-send')
  @HttpCode(200)
  suggestionFromShop(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { note?: unknown; media?: unknown },
  ) {
    return this.suggestions.sendFromShop(user, dto ?? {});
  }

  /** It does not fit this shop. The reason is the half worth having. */
  @Post('suggestions/:id/skip')
  @HttpCode(200)
  suggestionSkip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.suggestions.skip(user, id, dto?.reason);
  }

  // ---- the team's side of the same thing ----------------------------------

  /** Hand one trend to this salon. Team only (checked in the service). */
  @Post('suggestions')
  @HttpCode(200)
  sendSuggestion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: {
      title?: string; note?: string;
      refUrl?: string; refThumbUrl?: string;
      refCount?: unknown; refCountKind?: unknown; refPublishedAt?: unknown;
      sourceUrl?: string; sourceLabel?: string;
    },
  ) {
    return this.suggestions.create(user, dto ?? {});
  }

  /** The full rows, source links included. Team only. */
  @Get('suggestions/team')
  teamSuggestions(@CurrentUser() user: AuthenticatedUser) {
    return this.suggestions.listForTeam(user);
  }

  @Post('suggestions/:id/reopen')
  @HttpCode(200)
  suggestionReopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suggestions.reopen(user, id);
  }

  /** The footage became a post — take the card out of the team's inbox. */
  /** "I'll take this one." */
  @Post('suggestions/:id/claim')
  @HttpCode(200)
  suggestionClaim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suggestions.claim(user, id);
  }

  /** Back to received. */
  @Post('suggestions/:id/release')
  @HttpCode(200)
  suggestionRelease(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suggestions.release(user, id);
  }

  /** Take back a request the shop has not answered. */
  @Delete('suggestions/:id')
  suggestionWithdraw(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suggestions.withdraw(user, id);
  }

  /** Copies onto the hosting so a post can fetch them; returns the media with public addresses. */
  @Post('suggestions/:id/stage')
  @HttpCode(200)
  suggestionStage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suggestions.stage(user, id);
  }

  @Post('suggestions/:id/used')
  @HttpCode(200)
  suggestionUsed(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { note?: unknown }) {
    return this.suggestions.markUsed(user, id, dto?.note);
  }

  @Post('review/:postId/approve')
  reviewApprove(@CurrentUser() user: AuthenticatedUser, @Param('postId') postId: string) {
    return this.review.approveFor(user, postId);
  }

  /** Team only (enforced in the service): the link to drop into the salon's group chat. */
  @Post('review-link')
  reviewLink(@CurrentUser() user: AuthenticatedUser) {
    return this.review.ensureLink(user);
  }

  @Delete('review-link')
  revokeReviewLink(@CurrentUser() user: AuthenticatedUser) {
    return this.review.revokeLink(user);
  }

  // ---- scheduled posting to the salon's OWN Page and Instagram -------------
  // Every route is scoped to the caller's tenant inside the service, and the
  // page published to is looked up FROM that tenant: publishing to another
  // salon's Facebook Page would be a public, permanent mistake.

  /** The queue, plus whether each waiting post can still actually be sent. */
  @Get('posts')
  listPosts(@CurrentUser() user: AuthenticatedUser) {
    return this.publisher.list(user);
  }

  /**
   * Google's rules against a draft, while the writer is still typing: the
   * text Google would receive, what was stripped, every policy finding —
   * and, with `ai: true`, the model's look at the photo. Nothing is saved.
   */
  @Post('posts/google-check')
  @HttpCode(200)
  googleCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { message?: string; media?: { url?: string; kind?: string }[]; ai?: boolean },
  ) {
    return this.publisher.googleCheck(user, body ?? {});
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

  /**
   * Move a post along the team's path — writing → design → ready — or hand it
   * to somebody, or leave a note, without re-sending the caption and files.
   * See post-workflow.ts for the one rule this enforces.
   */
  @Patch('posts/:id/stage')
  setPostStage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: SetStageDto) {
    return this.publisher.setStage(user, id, body);
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

  // ---- what is trending in the trade ---------------------------------------
  // Shared rows (YouTube, Google) are the trade's, not anyone's; the Instagram
  // row and the service/event overlay are this tenant's and read only for it.

  /** Today's trend feed for this salon's trade and market, in both languages. */
  @Get('trends')
  trendFeed(@CurrentUser() user: AuthenticatedUser) {
    return this.trends.feedFor(user);
  }

  /** Pull again now, forced. Support/Super Admin only — the service refuses anyone else. */
  @Post('trends/refresh')
  refreshTrends(@CurrentUser() user: AuthenticatedUser) {
    return this.trends.refreshFor(user);
  }

  /**
   * Top public Instagram posts on one hashtag the salon typed.
   *
   * Reads PUBLIC content through the salon's own connected Instagram Business
   * account — the account holder granted that when they connected the Page.
   * Nothing is stored: the results are shown, one may be turned into a post of
   * the salon's own, and that is the end of it.
   *
   * Never 500s on Instagram saying no. A refusal from Meta is an answer the
   * screen has to show a person — the permission is missing, the week's thirty
   * hashtags are spent, the token expired — and an exception would turn every
   * one of those into the same blank red box.
   */
  @Post('trends/instagram/search')
  @HttpCode(200)
  searchHashtag(@CurrentUser() user: AuthenticatedUser, @Body() body: { tag?: unknown }) {
    return this.trends.searchHashtag(user, body?.tag);
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

  /** One step of one job on the sheet, ticked or unticked. Either side may tick. */
  @Post('weeks/:key/tick')
  @HttpCode(200)
  tickStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: { jobId?: unknown; step?: unknown; done?: unknown },
  ) {
    return this.svc.tickStep(user, key, dto ?? {});
  }

  /**
   * What this salon should spend on ads, so nobody has to invent it.
   * Read-only and never written into the spend record — see the service.
   */
  @Get('ads/budget')
  adsBudget(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.adsBudgetFor(user);
  }

  /** The offer form — what the plan, the caption and the story all quote. */
  @Get('offer')
  getOffer(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getOffer(user);
  }

  /** Team only (checked in the service, same reason as editWeek). */
  @Post('offer')
  @HttpCode(200)
  setOffer(@CurrentUser() user: AuthenticatedUser, @Body() dto: unknown) {
    return this.svc.setOffer(user, dto);
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
