import { BadRequestException, Body, Controller, Get, Optional, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { MessengerService } from './messenger.service';
import { InboxEventsService } from './inbox-events.service';
import { KnowledgeGapsService } from './knowledge-gaps.service';
import { AiDigestService } from './ai-digest.service';
import { BotReportService } from './bot-report.service';
import { UploadsService } from '../uploads/uploads.service';
import { PhotoLibraryService } from './photo-library.service';
import { ChatPayService } from './chat-pay.service';
import { resolveTenantScope } from '../common/tenant/tenant-context';
import { HandoffDto, LeadStatusDto, ThreadLeadDto, RenameThreadDto, SendTestDto, SuggestGreetingDto, UpdateMessengerDto } from './dto/messenger.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

/**
 * Who may do what in here.
 *
 * The class default is SALON_ADMIN, so anything NOT listed below stays with the
 * owner: connecting a Page, the bot's instructions, the pricing facts, deleting
 * conversations. Answering customers is a different job from configuring the
 * system, and a technician needs the first without ever being handed the second.
 *
 * Widening is therefore per-route and deliberate. RolesGuard uses
 * getAllAndOverride, so a @Roles() on a method replaces the class's — which
 * means a route only becomes reachable by staff when somebody typed INBOX_ROLES
 * on it, never by accident.
 */
/** The picture library, or a plain error when it is not wired (never a crash). Kept outside the class: it is not a route. */
function libOf(photos?: PhotoLibraryService): PhotoLibraryService {
  if (!photos) throw new BadRequestException('Photo library unavailable.');
  return photos;
}

/** A picture the customer sent, read once into a small data URL (≤ 3 MB, JPG/PNG/WebP). */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 3_000_000) return null;
    const type = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null;
    return type ? `data:${type};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

const INBOX_ROLES = [UserRole.SALON_ADMIN, UserRole.STAFF] as const;

/** Salon-admin management of the Messenger booking bot (tenant-scoped). */
@Roles(UserRole.SALON_ADMIN)
@Controller('messenger')
export class MessengerController {
  constructor(
    private readonly svc: MessengerService,
    private readonly events: InboxEventsService,
    private readonly gaps: KnowledgeGapsService,
    private readonly report: BotReportService,
    private readonly digest: AiDigestService,
    // The salon's own upload folder, for a photo a person sends from the Inbox. Optional so a storage problem never takes the Inbox down.
    @Optional() private readonly uploads?: UploadsService,
    // Thư viện ảnh gửi khách (19/11/2026). Optional so a library problem never takes the Inbox down.
    @Optional() private readonly photos?: PhotoLibraryService,
    // Mã QR đặt cọc gửi trong chat (19/11/2026).
    @Optional() private readonly pay?: ChatPayService,
  ) {}

  // ---- Thư viện ảnh gửi khách. Reading it: owner and staff (the Inbox picker). Changing it: owner only (class default).
  @Roles(...INBOX_ROLES)
  @Get('photo-library')
  photoLibrary(@CurrentUser() user: AuthenticatedUser) {
    return libOf(this.photos).list(user);
  }

  /** A new picture: stored in the CALLER'S salon folder, then labelled. */
  @Post('photo-library')
  async addPhoto(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    if (!this.uploads) throw new BadRequestException('STORAGE_NOT_CONFIGURED');
    const dataUrl = typeof dto?.dataUrl === 'string' ? dto.dataUrl : '';
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) throw new BadRequestException('Chỉ thêm được ảnh JPG, PNG hoặc WebP.');
    const url = await this.uploads.uploadDataUrl(tenantId, dataUrl);
    return libOf(this.photos).create(user, url, dto ?? {});
  }

  @Post('photo-library/import')
  importPhotos(@CurrentUser() user: AuthenticatedUser) {
    return libOf(this.photos).reimport(user);
  }

  @Get('photo-library/rules')
  photoRules(@CurrentUser() user: AuthenticatedUser) {
    return libOf(this.photos).getRules(user);
  }

  @Post('photo-library/rules')
  savePhotoRules(@CurrentUser() user: AuthenticatedUser, @Body() dto: unknown) {
    return libOf(this.photos).setRules(user, dto);
  }

  @Post('photo-library/:id')
  updatePhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return libOf(this.photos).update(user, id, dto ?? {});
  }

  @Post('photo-library/:id/delete')
  deletePhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return libOf(this.photos).remove(user, id);
  }

  /** Beside a conversation: pictures that fit what the customer last wrote, and any the AI is holding for a person. */
  @Roles(...INBOX_ROLES)
  @Get('threads/:id/photo-suggest')
  async photoSuggest(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const out = await libOf(this.photos).suggest(user, id);
    const tenantId = resolveTenantScope(user);
    const pay = this.pay && tenantId ? (await this.pay.requestsOf(tenantId)).filter((r) => r.threadId === id).slice(0, 3) : [];
    return { ...out, pay };
  }

  /** The "QR đặt cọc" panel beside a conversation: can this salon send one, the next booking, what was sent before. */
  @Roles(...INBOX_ROLES)
  @Get('threads/:id/pay-qr')
  payPanel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!this.pay) throw new BadRequestException('Unavailable.');
    return this.pay.panel(user, id);
  }

  /**
   * A PERSON sends the deposit QR (the AI never does): the salon's own
   * account, an exact amount and a code the bank feed and the receipt reader
   * look for. Sent through the same photo and text routes as anything typed.
   */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/pay-qr')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  async sendPayQr(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { amountCents?: unknown; appointmentId?: unknown }) {
    if (!this.pay) throw new BadRequestException('Unavailable.');
    await this.svc.assertOwnThread(user, id);
    const p = await this.pay.prepare(user, id, dto ?? {});
    const out = await this.svc.sendManualPhoto(user, id, p.url);
    await this.svc.sendManual(user, id, p.text).catch(() => undefined);
    await this.pay.recordSent(user, p.tenantId, id, { code: p.code, amount: p.amount, appointmentId: p.appointmentId }, null);
    return { ...out, code: p.code };
  }

  /**
   * Keep a customer's picture from this conversation in the library (their
   * result, or a design they liked). The address must be one this
   * conversation actually received; the file is copied into the salon's own
   * folder, and it stays locked for the AI until the owner ticks consent.
   */
  @Post('threads/:id/save-photo')
  async saveChatPhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { url?: unknown; kind?: unknown }) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    if (!this.uploads) throw new BadRequestException('STORAGE_NOT_CONFIGURED');
    const url = String(dto?.url ?? '');
    if (!(await this.svc.threadReceivedImage(user, id, url))) throw new BadRequestException('Ảnh này không thuộc cuộc trò chuyện.');
    const dataUrl = await fetchAsDataUrl(url);
    if (!dataUrl) throw new BadRequestException('Không tải được ảnh (có thể link của Facebook đã hết hạn).');
    const stored = await this.uploads.uploadDataUrl(tenantId, dataUrl);
    return libOf(this.photos).create(user, stored, { kind: dto?.kind === 'sample' ? 'sample' : 'result', consent: false, source: 'chat', aiAllowed: false });
  }

  /** A person sends one library picture. Same window, ownership and audit rules as any photo from the reply box. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/photo-library')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  async sendLibraryPhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { itemId?: unknown }) {
    const lib = libOf(this.photos);
    await this.svc.assertOwnThread(user, id);
    const item = await lib.sendable(user, String(dto?.itemId ?? ''));
    const out = await this.svc.sendManualPhoto(user, id, item.url);
    await lib.afterPersonSent(user, item.tenantId, id, item.id);
    return out;
  }

  /** "Bỏ qua" on a waiting suggestion. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/photo-waiting/clear')
  async clearPhotoWaiting(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.svc.assertOwnThread(user, id);
    const tenantId = resolveTenantScope(user);
    if (tenantId) await libOf(this.photos).clearPending(tenantId, id);
    return { ok: true };
  }

  // How the bot is doing: conversations → bookings, where the rest stopped, next steps.
  // Salon admin only (class default); one salon's rows only.
  @Get('bot-report')
  botReport(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    return this.report.report(user, days ? Number(days) : undefined);
  }

  /** The top of the AI page: which layout this salon sees, where the AI answers, and this salon's numbers. */
  @Roles(...INBOX_ROLES)
  @Get('ai-overview')
  async aiOverview(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    const [ui, numbers] = await Promise.all([this.svc.aiPageUi(user), this.report.overview(user, days ? Number(days) : undefined)]);
    return { ...ui, numbers };
  }

  // What the bot could not answer — the owner answers once, the bot knows from then on.
  // Salon admin only (class default); every query is scoped to the caller's salon.
  @Get('knowledge-gaps')
  knowledgeGaps(@CurrentUser() user: AuthenticatedUser) {
    return this.gaps.list(user);
  }

  @Post('knowledge-gaps/:id/answer')
  answerGap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { answer?: string }) {
    return this.gaps.answer(user, id, String(dto?.answer ?? ''));
  }

  /** "AI soạn giúp": a draft answer for the owner to approve (staff reply + this salon's notes and documents). Saves nothing. */
  @Post('knowledge-gaps/:id/draft')
  draftGap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.gaps.draft(user, id, lang);
  }

  @Post('knowledge-gaps/:id/dismiss')
  dismissGap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.gaps.dismiss(user, id);
  }

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.get(user);
  }

  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels', 'messengerAi')
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
  @RequiresFeature('channels', 'messengerAi')
  choose(@CurrentUser() user: AuthenticatedUser, @Body() dto: { pageId?: string; takeOver?: boolean }) {
    return this.svc.oauthChoose(user, String(dto?.pageId || ''), dto?.takeOver === true);
  }

  /** Lumio staff: keep one page on this salon, detach the rest in one press. */
  @Post('pages/keep-only')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  keepOnly(@CurrentUser() user: AuthenticatedUser, @Body() dto: { pageId?: string }) {
    return this.svc.keepOnlyPage(user, String(dto?.pageId || ''));
  }

  @Post('settings')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMessengerDto) {
    return this.svc.updateSettings(user, dto);
  }

  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels', 'messengerAi')
  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser, @Body() dto: { pageId?: string }) {
    return this.svc.disconnect(user, dto?.pageId ? String(dto.pageId) : undefined);
  }

  @Roles(...INBOX_ROLES)
  @Get('threads')
  threads(@CurrentUser() user: AuthenticatedUser, @Query('before') before?: string, @Query('take') take?: string) {
    return this.svc.listThreads(user, { before: before || undefined, take: take ? Number(take) : undefined });
  }

  /** Which Inbox this salon sees (release channel) and what kind of page it is. */
  @Roles(...INBOX_ROLES)
  @Get('inbox-ui')
  inboxUi(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.inboxUi(user);
  }

  /** Correct (or write down) the lead a conversation produced. The thread is looked up inside the caller's salon. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/lead')
  threadLead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ThreadLeadDto) {
    return this.svc.saveThreadLead(user, id, dto);
  }

  @Roles(...INBOX_ROLES)
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
  @Roles(...INBOX_ROLES)
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
  @Roles(...INBOX_ROLES)
  @Get('threads/:id')
  thread(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('full') full?: string) {
    // ?full=0 answers from our own tables only — the inbox paints with it
    // first, then asks again with the Meta transcript. See the service.
    return this.svc.getThread(user, id, full !== '0');
  }

  /**
   * rt204: the permanent record of one conversation — every message ever
   * logged (also those deleted or hidden on Meta) and who did what. The owner
   * (and a Lumio support session) only.
   */
  @Roles(UserRole.SALON_ADMIN)
  @Get('threads/:id/record')
  record(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.threadRecord(user, id);
  }

  /** Three lines and a draft reply for the person taking this chat over (handoff-brief). Sends nothing. */
  @Roles(...INBOX_ROLES)
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  @Post('threads/:id/brief')
  threadBrief(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.svc.threadBrief(user, id, lang);
  }

  /**
   * The customer's real profile picture, streamed through us.
   *
   * The Page token never leaves the server — see the service. 204 rather than
   * 404 when Meta withholds one, because "there is no picture" is a normal
   * answer here, not an error, and the inbox draws initials instead.
   */
  @Roles(...INBOX_ROLES)
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
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/notes')
  addNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { text?: string }) {
    return this.svc.addNote(user, id, String(dto?.text ?? ''));
  }

  @Roles(...INBOX_ROLES)
  @Post('threads/:id/notes/:noteId/delete')
  deleteNote(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.svc.deleteNote(user, id, noteId);
  }

  // ---- Labels and follow-ups ----------------------------------------------

  @Roles(...INBOX_ROLES)
  @Get('labels')
  labels(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listLabels(user);
  }

  @Roles(...INBOX_ROLES)
  @Post('labels')
  createLabel(@CurrentUser() user: AuthenticatedUser, @Body() dto: { name?: string; color?: string }) {
    return this.svc.createLabel(user, String(dto?.name ?? ''), String(dto?.color ?? ''));
  }

  @Post('labels/:labelId/delete')
  deleteLabel(@CurrentUser() user: AuthenticatedUser, @Param('labelId') labelId: string) {
    return this.svc.deleteLabel(user, labelId);
  }

  @Roles(...INBOX_ROLES)
  @Post('threads/:id/labels')
  setLabel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { labelId?: string; on?: boolean }) {
    return this.svc.setThreadLabel(user, id, String(dto?.labelId ?? ''), dto?.on !== false);
  }

  /** A date, not a label — a label cannot go overdue. See the service. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/followup')
  followUp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { at?: string | null; note?: string | null }) {
    return this.svc.setFollowUp(user, id, dto?.at ?? null, dto?.note ?? null);
  }

  /** Close a conversation. A new customer message reopens it automatically. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/status')
  threadStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { status?: string }) {
    const want = String(dto?.status ?? '');
    return this.svc.setThreadStatus(user, id, want === 'done' ? 'done' : want === 'spam' ? 'spam' : 'open');
  }

  /** Opening a conversation in the inbox clears its unread mark. */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/read')
  threadRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.markThreadRead(user, id);
  }

  /**
   * Put the unread mark BACK.
   *
   * Reading is not the same as dealing with it. Somebody opens a conversation
   * between two customers at the desk, sees it needs a price they have to go
   * and check, and walks away — and the one signal that would have brought
   * them back was spent by the act of looking. Every mail client has this for
   * the same reason.
   */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/unread')
  threadUnread(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.markThreadUnread(user, id);
  }

  /** Clear the whole unread pile at once, the way an inbox is triaged after lunch. */
  @Roles(...INBOX_ROLES)
  @Post('threads/read-all')
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.markAllRead(user);
  }

  @Roles(...INBOX_ROLES)
  @Post('threads/:id/rename')
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RenameThreadDto) {
    return this.svc.renameThread(user, id, dto.name);
  }

  /** Pull the Page's recent conversations into the inbox (the chats from before the connection). */
  @Post('import-conversations')
  importConversations(@CurrentUser() user: AuthenticatedUser, @Body() dto: { limit?: number }) {
    return this.svc.importConversations(user, Number(dto?.limit) || 50);
  }

  /** Read the salon's website or connected Page and propose Bot-facts rows. */
  @Post('import-facts')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  importFacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: { source?: string; url?: string; text?: string }) {
    return this.svc.importFacts(user, dto || {});
  }

  /** The one-tap survey after an AI booking (chat-survey): this salon's switch. Owner's call — it changes what customers are sent. */
  @Get('chat-survey')
  chatSurvey(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getChatSurvey(user);
  }

  @Post('chat-survey')
  setChatSurvey(@CurrentUser() user: AuthenticatedUser, @Body() dto: { on?: boolean }) {
    return this.svc.setChatSurvey(user, dto?.on === true);
  }

  /** The Monday AI digest for the salon's owner (ai-digest): this salon's switch, off by default. */
  @Get('ai-digest')
  aiDigest(@CurrentUser() user: AuthenticatedUser) {
    return this.digest.get(user);
  }

  @Post('ai-digest')
  setAiDigest(@CurrentUser() user: AuthenticatedUser, @Body() dto: { on?: boolean }) {
    return this.digest.set(user, dto?.on === true);
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

  /**
   * A photo from the reply box. The picture is stored in the CALLER'S salon
   * folder first (the tenant comes from the signed-in user, never the body),
   * then sent on the thread — which the service looks up inside that same salon.
   */
  @Roles(...INBOX_ROLES)
  @Post('threads/:id/photo')
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  async sendPhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { dataUrl?: unknown }) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope.');
    if (!this.uploads) throw new BadRequestException('STORAGE_NOT_CONFIGURED');
    const dataUrl = typeof dto?.dataUrl === 'string' ? dto.dataUrl : '';
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) throw new BadRequestException('Chỉ gửi được ảnh JPG, PNG hoặc WebP.');
    // Is this conversation ours? Asked BEFORE anything is stored, so a wrong id leaves no file behind.
    await this.svc.assertOwnThread(user, id);
    const url = await this.uploads.uploadDataUrl(tenantId, dataUrl);
    return this.svc.sendManualPhoto(user, id, url);
  }

  @Roles(...INBOX_ROLES)
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
