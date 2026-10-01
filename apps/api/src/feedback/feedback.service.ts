import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NotificationChannel, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { UploadsService } from '../uploads/uploads.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, hourTz, startOfDayTz, weekdayTz } from '../common/salon-time';
import { publicWebBase } from '../common/public-url.util';
import {
  AnswerRow, CASE_STATUSES, CaseStatus, DEFAULT_FEEDBACK_SETTINGS, FeedbackSettings, Sentiment,
  caseDueAt, cleanReasons, isOverdue, maskPhone, pct, reasonCounts, sanitizeSettings, staffLines,
  suggestFix, techFlags, waitCluster, weeklyTrend,
} from './feedback-logic';

export const FEEDBACK_SETTINGS_KEY = 'feedback_settings';
/** A link older than this no longer takes answers — a month-old "how was today?" is noise. */
const LINK_TTL_DAYS = 14;

type Row = Record<string, any>;

/**
 * The two-button "how was your visit?" — every visit's question, every
 * answer, and every "not quite" the salon has to make right.
 *
 * Tenant isolation: every staff-facing query carries the caller's tenantId;
 * the public side is reached only through a long random per-visit token and
 * resolves the tenant FROM that token, never from the request.
 */
@Injectable()
export class FeedbackService {
  private readonly log = new Logger('Feedback');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly push?: PushService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  /** The generated client predates these models; reach them untyped. */
  private get db(): Record<string, any> { return this.prisma as unknown as Record<string, any>; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<FeedbackSettings> {
    const row = await this.db.setting.findUnique({ where: { tenantId_key: { tenantId, key: FEEDBACK_SETTINGS_KEY } } }).catch(() => null);
    return sanitizeSettings((row?.value as Partial<FeedbackSettings>) ?? null, DEFAULT_FEEDBACK_SETTINGS);
  }

  async settingsView(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [settings, people, googleUrl] = await Promise.all([
      this.getSettings(tenantId),
      this.alertCandidates(tenantId),
      this.googleUrl(tenantId),
    ]);
    return { settings, people, googleConnected: !!googleUrl };
  }

  async updateSettings(user: AuthenticatedUser, dto: Partial<FeedbackSettings>) {
    const tenantId = this.tenantId(user);
    const current = await this.getSettings(tenantId);
    const next = sanitizeSettings(dto, current);
    await this.db.setting.upsert({
      where: { tenantId_key: { tenantId, key: FEEDBACK_SETTINGS_KEY } },
      update: { value: next },
      create: { tenantId, key: FEEDBACK_SETTINGS_KEY, value: next },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'feedback.settings_updated', resourceType: 'setting', resourceId: FEEDBACK_SETTINGS_KEY, metadata: { enabled: next.enabled } });
    return next;
  }

  /** Owners and managers of THIS salon — who may be told about a "not quite". */
  private async alertCandidates(tenantId: string): Promise<{ id: string; name: string; role: string }[]> {
    const users: Row[] = await this.db.user.findMany({
      where: { tenantId, role: { in: [UserRole.SALON_ADMIN, UserRole.STAFF] } },
      select: { id: true, role: true, firstName: true, lastName: true, email: true, staffMember: { select: { staffRole: true, firstName: true, lastName: true, isActive: true } } },
    }).catch(() => []);
    return users
      .filter((u) => u.role === UserRole.SALON_ADMIN || (u.staffMember?.staffRole === 'MANAGER' && u.staffMember?.isActive !== false))
      .map((u) => ({
        id: u.id,
        name: [u.firstName ?? u.staffMember?.firstName, u.lastName ?? u.staffMember?.lastName].filter(Boolean).join(' ') || u.email,
        role: u.role === UserRole.SALON_ADMIN ? 'Owner' : 'Manager',
      }));
  }

  private async googleUrl(tenantId: string): Promise<string | null> {
    return this.settings.effectiveGoogleReviewUrl(tenantId).catch(() => null);
  }

  // ------------------------------------------------------- creating requests

  /**
   * Called by the till right after a sale is paid. Decides whether this visit
   * gets asked at all (feature on, not asked recently) and remembers who did
   * what, so every screen afterwards can say "Lisa did your Gel Manicure".
   * Never throws: a sale that is taken must stay taken.
   */
  async createForOrder(tenantId: string, order: {
    id: string; customerId?: string | null; walkInId?: string | null; appointmentId?: string | null;
    items?: { kind?: string; name?: string; staffMemberId?: string | null }[];
  }): Promise<{ token: string | null; status: string; receiptQr?: boolean } | null> {
    try {
      const s = await this.getSettings(tenantId);
      if (!s.enabled) return null;
      const services = (order.items ?? []).filter((i) => String(i.kind) === 'SERVICE');
      const counts = new Map<string, number>();
      for (const i of services) if (i.staffMemberId) counts.set(i.staffMemberId, (counts.get(i.staffMemberId) ?? 0) + 1);
      const staffId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      let customer: Row | null = null;
      if (order.customerId) {
        customer = await this.db.customer.findFirst({ where: { id: order.customerId, tenantId }, select: { id: true, firstName: true, phone: true, email: true } });
      }
      let phone: string | null = customer?.phone ?? null;
      const email: string | null = customer?.email && /@/.test(customer.email) ? String(customer.email).trim() : null;
      let name: string | null = customer?.firstName ?? null;
      if (!phone && order.walkInId) {
        const w = await this.db.walkIn.findFirst({ where: { id: order.walkInId, tenantId }, select: { phone: true, customerName: true } }).catch(() => null);
        phone = w?.phone ?? null; name = name ?? w?.customerName ?? null;
      }

      // A customer who answered a "not quite" and came back again: the case won them back.
      if (customer) {
        await this.db.feedbackCase.updateMany({ where: { tenantId, customerId: customer.id, wonBack: null, status: { in: ['CONTACTED', 'RESOLVED'] } }, data: { wonBack: true } }).catch(() => undefined);
      }

      let status = 'PENDING';
      if (customer && s.cooldownDays > 0) {
        const since = new Date(Date.now() - s.cooldownDays * 86_400_000);
        const recent = await this.db.feedbackRequest.count({ where: { tenantId, customerId: customer.id, createdAt: { gte: since }, status: { in: ['PENDING', 'ANSWERED'] } } });
        if (recent > 0) status = 'COOLDOWN';
      }
      const token = randomBytes(18).toString('base64url');
      // One follow-up time for both channels: a text and/or an email, whichever the
      // salon switched on and the customer can receive.
      const canFollowUp = (s.smsFallback && !!phone) || (s.emailFallback && !!email);
      const smsDueAt = status === 'PENDING' && canFollowUp ? new Date(Date.now() + s.smsDelayMinutes * 60_000) : null;
      await this.db.feedbackRequest.create({
        data: {
          tenantId, token, orderId: order.id, appointmentId: order.appointmentId ?? null, walkInId: order.walkInId ?? null,
          customerId: customer?.id ?? null, staffId, customerName: name, phone, email,
          serviceNames: services.map((i) => String(i.name ?? '')).filter(Boolean).slice(0, 6),
          status, smsDueAt,
        },
      });
      return { token: status === 'PENDING' ? token : null, status, receiptQr: status === 'PENDING' && s.receiptQr };
    } catch (e) {
      this.log.warn(`createForOrder failed for ${tenantId}: ${(e as Error).message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------- public

  private async requestByToken(token: string): Promise<Row> {
    if (!token || token.length < 16 || token.length > 64) throw new NotFoundException('This link is not valid');
    const r = await this.db.feedbackRequest.findUnique({ where: { token } });
    if (!r) throw new NotFoundException('This link is not valid');
    return r;
  }

  private langFor(market: string | null | undefined): 'en' | 'vi' {
    return String(market ?? '').toUpperCase() === 'VN' ? 'vi' : 'en';
  }

  /** What the customer's screen needs — and nothing internal. */
  async publicContext(token: string) {
    const r = await this.requestByToken(token);
    const [tenant, s, staff, googleUrl] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: r.tenantId }, select: { name: true, branding: true, market: true } }).catch(() => null),
      this.getSettings(r.tenantId),
      r.staffId ? this.db.staffMember.findFirst({ where: { id: r.staffId, tenantId: r.tenantId }, select: { firstName: true, lastName: true, avatarUrl: true } }) : Promise.resolve(null),
      this.googleUrl(r.tenantId),
    ]);
    const brand = this.settings.brandingFrom(tenant?.branding);
    const expired = r.status === 'EXPIRED' || r.createdAt.getTime() < Date.now() - LINK_TTL_DAYS * 86_400_000;
    let answered: Sentiment | null = null;
    let answeredPhoto = false;
    if (r.feedbackId) {
      const f = await this.db.feedback.findFirst({ where: { id: r.feedbackId, tenantId: r.tenantId }, select: { sentiment: true, photoUrl: true } });
      answered = (f?.sentiment as Sentiment) ?? null;
      answeredPhoto = !!f?.photoUrl;
    }
    return {
      salonName: tenant?.name ?? '',
      logoUrl: brand.logoUrl || null,
      accentColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand.accentColor || '') ? brand.accentColor : '#6366f1',
      lang: this.langFor(tenant?.market),
      customerFirstName: r.customerName ? String(r.customerName).split(' ')[0] : null,
      staffName: staff ? staff.firstName : null,
      staffInitials: staff ? `${staff.firstName?.[0] ?? ''}${staff.lastName?.[0] ?? ''}`.toUpperCase() : null,
      staffAvatar: staff?.avatarUrl ?? null,
      services: Array.isArray(r.serviceNames) ? r.serviceNames : [],
      visitAt: r.visitAt,
      reasons: s.reasons,
      askPhoto: s.askPhoto,
      replyHours: s.replyHours,
      maskedPhone: maskPhone(r.phone),
      hasPhone: !!r.phone,
      // A photo already arrived for this visit (from the customer's phone) — the
      // shared screen shows it as received rather than asking again.
      hasPhoto: !!r.photoUrl || answeredPhoto,
      googleUrl,
      answered,
      expired: expired && !answered,
    };
  }

  /**
   * The customer's answer. One answer per visit: a second post returns what the
   * first one did. A "not quite" opens a case and wakes the owner's phone.
   */
  async publicSubmit(token: string, dto: { sentiment: string; reasons?: string[]; comment?: string; wantsContact?: boolean; source?: string; photoUrl?: string }) {
    const r = await this.requestByToken(token);
    const tenantId: string = r.tenantId;
    const sentiment: Sentiment | null = dto.sentiment === 'HAPPY' ? 'HAPPY' : dto.sentiment === 'UNHAPPY' ? 'UNHAPPY' : null;
    if (!sentiment) throw new BadRequestException('sentiment must be HAPPY or UNHAPPY');
    const googleUrl = await this.googleUrl(tenantId);
    if (r.feedbackId) return { ok: true, already: true, googleUrl };
    if (r.status === 'EXPIRED' || r.createdAt.getTime() < Date.now() - LINK_TTL_DAYS * 86_400_000) throw new BadRequestException('This link has expired');

    const s = await this.getSettings(tenantId);
    const reasons = sentiment === 'UNHAPPY' ? cleanReasons(dto.reasons, s.reasons) : [];
    const source = ['ipad', 'sms', 'email', 'qr', 'link'].includes(String(dto.source)) ? String(dto.source) : 'link';
    const sent = dto.photoUrl ?? r.photoUrl ?? '';
    const photoUrl = s.askPhoto && /^https:\/\//i.test(String(sent)) ? String(sent).slice(0, 600) : null;

    // Claim the request first so two taps can never write two answers.
    const claimed = await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId, feedbackId: null }, data: { status: 'ANSWERED', answeredAt: new Date() } });
    if (!claimed.count) return { ok: true, already: true, googleUrl };

    const fb = await this.db.feedback.create({
      data: {
        tenantId, staffId: r.staffId ?? null, customerId: r.customerId ?? null,
        rating: sentiment === 'HAPPY' ? 5 : 2,
        comment: dto.comment ? String(dto.comment).slice(0, 1000) : null,
        invitedToGoogle: false, // set when they actually tap through
        appointmentId: r.appointmentId ?? null, verified: false,
        sentiment, reasons, wantsContact: sentiment === 'UNHAPPY' && !!dto.wantsContact && !!r.phone,
        photoUrl, source, requestId: r.id, orderId: r.orderId ?? null,
      },
    });
    await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId }, data: { feedbackId: fb.id } });

    if (sentiment === 'UNHAPPY') {
      const now = new Date();
      const c = await this.db.feedbackCase.create({
        data: { tenantId, feedbackId: fb.id, customerId: r.customerId ?? null, staffId: r.staffId ?? null, status: 'NEW', dueAt: caseDueAt(now, s.replyHours) },
      });
      await this.db.feedbackCaseEvent.create({ data: { tenantId, caseId: c.id, kind: 'received', text: source === 'ipad' ? 'Answered on the salon iPad' : source === 'sms' ? 'Answered from the text link' : 'Answered from the link' } });
      await this.audit.log({ tenantId, userId: null, action: 'feedback.unhappy_received', resourceType: 'feedback_case', resourceId: c.id, metadata: { staffId: r.staffId, reasons } });
      await this.alertOwners(tenantId, s, r, c.id, reasons, fb.wantsContact).catch(() => undefined);
    }
    return { ok: true, googleUrl };
  }

  /** The optional photo with a "not quite" — stored in the salon's own folder before the answer is sent. */
  /**
   * A photo for this visit. Three moments, one endpoint:
   *  - on the phone, before answering → the form sends the url with the answer;
   *  - from the phone while the customer answers on the SHARED screen → kept on
   *    the request and picked up when the answer arrives;
   *  - after a "not quite" was sent → attached to it, and the case hears about it.
   */
  async publicPhoto(token: string, dataUrl: string) {
    const r = await this.requestByToken(token);
    const s = await this.getSettings(r.tenantId);
    if (!s.askPhoto || !this.uploads) throw new BadRequestException('Photos are not accepted here');
    let fb: Row | null = null;
    if (r.feedbackId) {
      fb = await this.db.feedback.findFirst({ where: { id: r.feedbackId, tenantId: r.tenantId }, select: { id: true, sentiment: true, photoUrl: true } });
      if (!fb || fb.sentiment !== 'UNHAPPY') throw new BadRequestException('Already answered');
      if (fb.photoUrl) throw new BadRequestException('A photo was already added');
    }
    const url = await this.uploads.uploadDataUrl(r.tenantId, String(dataUrl ?? ''));
    if (fb) {
      await this.db.feedback.updateMany({ where: { id: fb.id, tenantId: r.tenantId }, data: { photoUrl: url } });
      const c = await this.db.feedbackCase.findFirst({ where: { tenantId: r.tenantId, feedbackId: fb.id }, select: { id: true } });
      if (c) await this.db.feedbackCaseEvent.create({ data: { tenantId: r.tenantId, caseId: c.id, kind: 'photo', text: 'Customer added a photo' } });
    } else {
      await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId: r.tenantId }, data: { photoUrl: url } });
    }
    return { url };
  }

  /** A tap through to Google — counted per answer, once. */
  async publicGoogleTap(token: string) {
    const r = await this.requestByToken(token);
    if (r.feedbackId) await this.db.feedback.updateMany({ where: { id: r.feedbackId, tenantId: r.tenantId }, data: { invitedToGoogle: true } });
    return { url: await this.googleUrl(r.tenantId) };
  }

  /** "Text me the link" on the shared iPad — once per visit, to the phone on the bill. */
  async publicTextLink(token: string) {
    const r = await this.requestByToken(token);
    if (!r.phone || !this.notifications) return { sent: false };
    const already = await this.db.notification.count({ where: { tenantId: r.tenantId, relatedType: 'feedback_google_link', relatedId: r.id } }).catch(() => 0);
    if (already > 0) return { sent: true };
    const tenant = await this.db.tenant.findUnique({ where: { id: r.tenantId }, select: { name: true } });
    const link = `${publicWebBase()}/f/${r.token}/google`;
    await this.notifications.send({
      tenantId: r.tenantId, channel: NotificationChannel.SMS, recipient: r.phone,
      body: `${tenant?.name ?? 'Thank you'}: thanks for visiting! Here's the link to share it on Google: ${link}`,
      relatedType: 'feedback_google_link', relatedId: r.id,
    });
    return { sent: true };
  }

  private async alertOwners(tenantId: string, s: FeedbackSettings, r: Row, caseId: string, reasons: string[], wantsContact: boolean) {
    // The technician's pattern: the Nth same reason inside the window is worth a note on their file.
    let pattern: string | null = null;
    if (r.staffId && reasons.length) {
      const since = new Date(Date.now() - s.alertWindowDays * 86_400_000);
      const rows: Row[] = await this.db.feedback.findMany({ where: { tenantId, staffId: r.staffId, sentiment: 'UNHAPPY', createdAt: { gte: since } }, select: { reasons: true } });
      for (const reason of reasons) {
        const n = rows.filter((x) => Array.isArray(x.reasons) && x.reasons.includes(reason)).length;
        if (n === s.alertSameReason) {
          pattern = `${n}× “${reason}” in ${s.alertWindowDays} days`;
          await this.db.staffCoaching.create({ data: { tenantId, staffId: r.staffId, kind: 'AUTO', text: `${pattern} — owner alerted.` } });
          break;
        }
      }
    }
    if (!s.alertPush || !this.push) return;
    const staff = r.staffId ? await this.db.staffMember.findFirst({ where: { id: r.staffId, tenantId }, select: { firstName: true } }) : null;
    const who = r.customerName || 'A customer';
    const body = [reasons.join(' · ') || 'No reason picked', staff ? `— ${staff.firstName}` : '', wantsContact ? '· wants a call back' : '', pattern ? `· ${staff?.firstName ?? 'Tech'}: ${pattern}` : ''].filter(Boolean).join(' ');
    const targets = (await this.alertCandidates(tenantId)).filter((u) => !s.alertUserIds.length || s.alertUserIds.includes(u.id));
    await Promise.all(targets.map((u) => this.push!.sendToUser(tenantId, u.id, { title: `😕 ${who} wasn't happy`, body, url: `/salon/feedback?case=${caseId}`, tag: 'lumio-feedback' }).catch(() => 0)));
  }

  // ------------------------------------------------------------------ POS

  /** What the till's Paid screen shows — neutral: never whether they were happy. */
  async statusForOrder(user: AuthenticatedUser, orderId: string) {
    const tenantId = this.tenantId(user);
    const r = await this.db.feedbackRequest.findFirst({ where: { tenantId, orderId }, orderBy: { createdAt: 'desc' } });
    if (!r) return { status: 'NONE' as const };
    const st = await this.getSettings(tenantId);
    return {
      id: r.id, status: r.status as string, answered: !!r.feedbackId,
      smsDueAt: r.smsDueAt, smsSentAt: r.smsSentAt ?? r.emailSentAt ?? null, hasPhone: !!r.phone,
      hasEmail: !!r.email, smsOn: st.smsFallback && !!r.phone, emailOn: st.emailFallback && !!r.email,
      link: `${publicWebBase()}/f/${r.token}`,
      smsDelayMinutes: st.smsDelayMinutes, cooldownDays: st.cooldownDays,
    };
  }

  async skip(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const res = await this.db.feedbackRequest.updateMany({ where: { id, tenantId, status: 'PENDING' }, data: { status: 'SKIPPED', smsDueAt: null } });
    if (!res.count) throw new NotFoundException('Nothing to skip');
    return { ok: true };
  }

  async sendNow(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const r = await this.db.feedbackRequest.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING' || (!r.phone && !r.email)) throw new BadRequestException('This visit cannot be texted');
    if (r.smsSentAt || r.emailSentAt) return { ok: true, already: true };
    await this.sendLink(r);
    return { ok: true };
  }

  /**
   * The follow-up for a visit nobody answered on the screen: a text and/or an
   * email, each only when the salon switched that channel on and the customer
   * can receive it. Each goes once; the timestamps are the proof.
   */
  private async sendLink(r: Row) {
    if (!this.notifications) return;
    const s = await this.getSettings(r.tenantId);
    const tenant = await this.db.tenant.findUnique({ where: { id: r.tenantId }, select: { name: true, market: true, branding: true } });
    const name = r.customerName ? String(r.customerName).split(' ')[0] : null;
    const vi = this.langFor(tenant?.market) === 'vi';
    const salon = tenant?.name ?? '';
    const jobs: Promise<unknown>[] = [];
    let n: Row | null = null;
    try { n = await (this.settings as Row).getNotificationSettings?.(r.tenantId); } catch { n = null; }

    if (s.smsFallback && r.phone && !r.smsSentAt) {
      const link = `${publicWebBase()}/f/${r.token}?src=sms`;
      const body = vi
        ? `${salon}: ${name ? `Chào ${name}, ` : ''}cảm ơn bạn đã ghé tiệm! Hôm nay bạn thấy thế nào? Chỉ 1 chạm: ${link}`
        : `${salon}: ${name ? `Hi ${name}, ` : ''}thanks for visiting! How was everything today? One tap: ${link} Reply STOP to opt out.`;
      const claimed = await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId: r.tenantId, smsSentAt: null }, data: { smsSentAt: new Date() } });
      if (claimed.count) jobs.push(this.notifications.send({ tenantId: r.tenantId, channel: NotificationChannel.SMS, recipient: r.phone, body: body.trim(), relatedType: 'feedback_request', relatedId: r.id, ...(n?.twilio ? { twilio: n.twilio } : {}) } as never));
    }

    if (s.emailFallback && r.email && !r.emailSentAt) {
      const claimed = await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId: r.tenantId, emailSentAt: null }, data: { emailSentAt: new Date() } });
      if (claimed.count) {
        const staff = r.staffId ? await this.db.staffMember.findFirst({ where: { id: r.staffId, tenantId: r.tenantId }, select: { firstName: true } }) : null;
        const services: string[] = Array.isArray(r.serviceNames) ? r.serviceNames.map(String) : [];
        const brand = this.settings.brandingFrom(tenant?.branding);
        const mail = feedbackEmail({
          vi, salon, firstName: name, tech: staff?.firstName ?? null, service: services[0] ?? null,
          accent: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand.accentColor || '') ? brand.accentColor : '#6366f1',
          link: `${publicWebBase()}/f/${r.token}`,
        });
        jobs.push(this.notifications.send({ tenantId: r.tenantId, channel: NotificationChannel.EMAIL, recipient: r.email, subject: mail.subject, body: mail.text, html: mail.html, relatedType: 'feedback_request', relatedId: r.id, ...emailTransport(n, salon) } as never));
      }
    }
    await Promise.allSettled(jobs);
  }

  /** The dispatcher's sweep: text the visits nobody answered on the iPad, retire stale links. */
  async processDue(now = new Date()): Promise<{ sent: number; expired: number }> {
    let sent = 0;
    const due: Row[] = await this.db.feedbackRequest.findMany({ where: { status: 'PENDING', smsSentAt: null, emailSentAt: null, smsDueAt: { lte: now } }, take: 200, orderBy: { smsDueAt: 'asc' } });
    for (const r of due) {
      try {
        if (r.phone || r.email) { await this.sendLink(r); sent += 1; }
      } catch (e) { this.log.warn(`feedback follow-up failed ${r.id}: ${(e as Error).message}`); }
      // Whatever happened, this visit's follow-up is done — never picked up again.
      await this.db.feedbackRequest.updateMany({ where: { id: r.id, tenantId: r.tenantId }, data: { smsDueAt: null } });
    }
    const old = new Date(now.getTime() - LINK_TTL_DAYS * 86_400_000);
    const ex = await this.db.feedbackRequest.updateMany({ where: { status: 'PENDING', createdAt: { lt: old } }, data: { status: 'EXPIRED' } });
    return { sent, expired: ex.count ?? 0 };
  }

  // ------------------------------------------------------------- dashboard

  private async tzOf(tenantId: string): Promise<string> {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone || 'UTC';
  }

  private range(tz: string, from?: string, to?: string, days = 30) {
    const today = dayKeyTz(new Date(), tz);
    const toKey = /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? to! : today;
    const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') ? from! : addDaysToKey(toKey, -(days - 1));
    const start = startOfDayTz(fromKey, tz);
    const end = startOfDayTz(addDaysToKey(toKey, 1), tz);
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    return { fromKey, toKey, start, end, prevStart: new Date(start.getTime() - span * 86_400_000), today };
  }

  private toRows(list: Row[], tz: string): AnswerRow[] {
    return list.map((f) => ({
      dayKey: dayKeyTz(f.createdAt, tz),
      sentiment: f.sentiment as Sentiment,
      staffId: f.staffId ?? null,
      reasons: Array.isArray(f.reasons) ? f.reasons.map(String) : [],
      toGoogle: !!f.invitedToGoogle,
    }));
  }

  private async staffNames(tenantId: string): Promise<Map<string, { name: string; initials: string; avatarUrl: string | null; active: boolean }>> {
    const list: Row[] = await this.db.staffMember.findMany({ where: { tenantId }, select: { id: true, firstName: true, lastName: true, avatarUrl: true, isActive: true } });
    return new Map(list.map((s) => [s.id, {
      name: [s.firstName, s.lastName].filter(Boolean).join(' '),
      initials: `${s.firstName?.[0] ?? ''}${s.lastName?.[0] ?? ''}`.toUpperCase(),
      avatarUrl: s.avatarUrl ?? null, active: s.isActive !== false,
    }]));
  }

  async overview(user: AuthenticatedUser, q: { from?: string; to?: string; staffId?: string }) {
    const tenantId = this.tenantId(user);
    const [tz, s] = await Promise.all([this.tzOf(tenantId), this.getSettings(tenantId)]);
    const rg = this.range(tz, q.from, q.to);
    const staffFilter = q.staffId ? { staffId: q.staffId } : {};
    const trendStart = startOfDayTz(addDaysToKey(rg.today, -7 * 12), tz);
    const [cur, prev, trendList, visits, cases, names] = await Promise.all([
      this.db.feedback.findMany({ where: { tenantId, sentiment: { not: null }, createdAt: { gte: rg.start, lt: rg.end }, ...staffFilter }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } }),
      this.db.feedback.findMany({ where: { tenantId, sentiment: { not: null }, createdAt: { gte: rg.prevStart, lt: rg.start }, ...staffFilter }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } }),
      this.db.feedback.findMany({ where: { tenantId, sentiment: { not: null }, createdAt: { gte: trendStart }, ...staffFilter }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } }),
      this.db.feedbackRequest.count({ where: { tenantId, createdAt: { gte: rg.start, lt: rg.end }, status: { not: 'COOLDOWN' }, ...staffFilter } }),
      this.db.feedbackCase.findMany({ where: { tenantId, ...staffFilter, OR: [{ createdAt: { gte: rg.start, lt: rg.end } }, { status: { in: ['NEW', 'IN_PROGRESS'] } }] }, select: { id: true, status: true, dueAt: true, createdAt: true, firstResponseAt: true, wonBack: true, customerId: true, staffId: true, feedbackId: true } }),
      this.staffNames(tenantId),
    ]);
    const rows = this.toRows(cur, tz);
    const prevRows = this.toRows(prev, tz);
    const tRows = this.toRows(trendList, tz);
    const happy = rows.filter((r) => r.sentiment === 'HAPPY').length;
    const prevHappy = prevRows.filter((r) => r.sentiment === 'HAPPY').length;
    const google = rows.filter((r) => r.toGoogle).length;
    const now = new Date();
    const open = cases.filter((c: Row) => c.status === 'NEW' || c.status === 'IN_PROGRESS');
    const overdue = open.filter((c: Row) => isOverdue(c as { status: string; dueAt: Date }, now));
    const inRange = cases.filter((c: Row) => c.createdAt >= rg.start && c.createdAt < rg.end);
    const replied = inRange.filter((c: Row) => c.firstResponseAt);
    const avgReplyMin = replied.length ? Math.round(replied.reduce((a: number, c: Row) => a + (c.firstResponseAt.getTime() - c.createdAt.getTime()), 0) / replied.length / 60000) : null;
    const closed = inRange.filter((c: Row) => c.status === 'CONTACTED' || c.status === 'RESOLVED');
    const wonBack = closed.filter((c: Row) => c.wonBack === true).length;

    // Technicians: this period's numbers + an 8-week line each.
    const lines = staffLines(rows);
    const tech = lines.map((l) => {
      const n = names.get(l.staffId);
      const weeks = weeklyTrend(tRows.filter((r) => r.staffId === l.staffId), rg.today, 8).map((w) => w.pct);
      return { ...l, name: n?.name ?? 'Former staff', initials: n?.initials ?? '?', avatarUrl: n?.avatarUrl ?? null, weeks };
    }).sort((a, b) => b.answers - a.answers);

    // What needs the owner: technician patterns, overdue cases, a wait cluster.
    const windowStart = startOfDayTz(addDaysToKey(rg.today, -(s.alertWindowDays - 1)), tz);
    const windowRows = this.toRows(trendList.filter((f: Row) => f.createdAt >= windowStart), tz);
    const flags = techFlags(windowRows, s.alertSameReason).map((f) => {
      const all = tech.find((t) => t.staffId === f.staffId);
      return { kind: 'tech' as const, staffId: f.staffId, name: names.get(f.staffId)?.name ?? 'A technician', reason: f.reason, count: f.count, days: s.alertWindowDays, pct: all?.pct ?? null, weeks: all?.weeks ?? [] };
    });
    const overdueList = await this.caseHeads(tenantId, overdue.slice(0, 3).map((c: Row) => c.id), names);
    const waitedHours = cur.filter((f: Row) => Array.isArray(f.reasons) && f.reasons.includes('Waited too long')).map((f: Row) => hourTz(f.createdAt, tz));
    const cluster = waitCluster(waitedHours);

    return {
      range: { from: rg.fromKey, to: rg.toKey },
      kpis: {
        answers: rows.length, happy, pct: pct(happy, rows.length), prevPct: pct(prevHappy, prevRows.length),
        responseRate: pct(rows.length, visits), visits,
        google, prevGoogle: prevRows.filter((r) => r.toGoogle).length, googleOfHappy: pct(google, happy),
        open: open.length, overdue: overdue.length, avgReplyMin,
        wonBack, closed: closed.length,
      },
      spark: weeklyTrend(tRows, rg.today, 8).map((w) => w.pct),
      trend: weeklyTrend(tRows, rg.today, 12),
      staff: tech,
      reasons: reasonCounts(rows),
      unhappy: rows.length - happy,
      attention: { flags, overdue: overdueList, waitCluster: cluster },
      goalPct: 90,
    };
  }

  /** Short headers for a list of cases — name, tech, service, reasons, clock. */
  private async caseHeads(tenantId: string, ids: string[], names?: Map<string, { name: string }>) {
    if (!ids.length) return [];
    const list: Row[] = await this.db.feedbackCase.findMany({ where: { tenantId, id: { in: ids } }, orderBy: { createdAt: 'desc' } });
    const fbIds = list.map((c) => c.feedbackId);
    const fbs: Row[] = await this.db.feedback.findMany({ where: { tenantId, id: { in: fbIds } }, select: { id: true, reasons: true, comment: true, wantsContact: true, requestId: true, createdAt: true } });
    const reqIds = fbs.map((f) => f.requestId).filter(Boolean);
    const reqs: Row[] = reqIds.length ? await this.db.feedbackRequest.findMany({ where: { tenantId, id: { in: reqIds } }, select: { id: true, customerName: true, serviceNames: true, visitAt: true } }) : [];
    const nm = names ?? await this.staffNames(tenantId);
    const now = new Date();
    return list.map((c) => {
      const f = fbs.find((x) => x.id === c.feedbackId);
      const r = reqs.find((x) => x.id === f?.requestId);
      return {
        id: c.id, status: c.status as CaseStatus, dueAt: c.dueAt, overdue: isOverdue(c as { status: string; dueAt: Date }, now),
        createdAt: c.createdAt, assigneeName: c.assigneeName ?? null,
        customerName: r?.customerName ?? 'Customer', staffName: c.staffId ? nm.get(c.staffId)?.name ?? null : null,
        service: Array.isArray(r?.serviceNames) ? r!.serviceNames.join(', ') : null, visitAt: r?.visitAt ?? c.createdAt,
        reasons: Array.isArray(f?.reasons) ? f!.reasons : [], wantsContact: !!f?.wantsContact, comment: f?.comment ?? null,
      };
    });
  }

  async staffCard(user: AuthenticatedUser, staffId: string, q: { from?: string; to?: string }) {
    const tenantId = this.tenantId(user);
    const staff = await this.db.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { id: true, firstName: true, lastName: true, avatarUrl: true, createdAt: true, isActive: true } });
    if (!staff) throw new NotFoundException('Technician not found');
    const [tz, s, names] = await Promise.all([this.tzOf(tenantId), this.getSettings(tenantId), this.staffNames(tenantId)]);
    const rg = this.range(tz, q.from, q.to);
    const trendStart = startOfDayTz(addDaysToKey(rg.today, -7 * 12), tz);
    const [all, cases, coaching, latest] = await Promise.all([
      this.db.feedback.findMany({ where: { tenantId, sentiment: { not: null }, createdAt: { gte: trendStart < rg.start ? trendStart : rg.start } }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } }),
      this.db.feedbackCase.findMany({ where: { tenantId, staffId, createdAt: { gte: rg.start, lt: rg.end } }, select: { id: true, status: true, dueAt: true, wonBack: true } }),
      this.db.staffCoaching.findMany({ where: { tenantId, staffId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.db.feedback.findMany({ where: { tenantId, staffId, sentiment: { not: null } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, createdAt: true, sentiment: true, reasons: true, comment: true, invitedToGoogle: true, requestId: true } }),
    ]);
    const rowsAll = this.toRows(all, tz);
    const inRange = this.toRows(all.filter((f: Row) => f.createdAt >= rg.start && f.createdAt < rg.end), tz);
    const mine = inRange.filter((r) => r.staffId === staffId);
    const happy = mine.filter((r) => r.sentiment === 'HAPPY').length;
    const salonHappy = inRange.filter((r) => r.sentiment === 'HAPPY').length;
    const lines = staffLines(inRange).filter((l) => l.answers > 0).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.answers - a.answers);
    const rank = lines.findIndex((l) => l.staffId === staffId);
    const myTrend = weeklyTrend(rowsAll.filter((r) => r.staffId === staffId), rg.today, 12);
    const salonTrend = weeklyTrend(rowsAll, rg.today, 12);
    const now = new Date();

    // A pattern worth saying out loud: when the complaints happen.
    const unhappyMine = all.filter((f: Row) => f.staffId === staffId && f.sentiment === 'UNHAPPY' && f.createdAt >= rg.start && f.createdAt < rg.end);
    let pattern: string | null = null;
    if (unhappyMine.length >= 3) {
      const byDow = new Map<number, number>();
      for (const f of unhappyMine) { const d = weekdayTz(f.createdAt, tz); byDow.set(d, (byDow.get(d) ?? 0) + 1); }
      const [dow, n] = [...byDow].sort((a, b) => b[1] - a[1])[0];
      const late = unhappyMine.filter((f: Row) => hourTz(f.createdAt, tz) >= 16).length;
      const dayName = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][dow];
      if (n * 2 >= unhappyMine.length) pattern = `${n} of ${unhappyMine.length} “not quite” came on ${dayName}${late * 2 >= unhappyMine.length ? ', mostly after 4 PM' : ''}.`;
      else if (late * 2 >= unhappyMine.length) pattern = `${late} of ${unhappyMine.length} “not quite” came after 4 PM.`;
    }

    const reqIds = latest.map((f: Row) => f.requestId).filter(Boolean);
    const reqs: Row[] = reqIds.length ? await this.db.feedbackRequest.findMany({ where: { tenantId, id: { in: reqIds } }, select: { id: true, customerName: true, serviceNames: true } }) : [];
    const caseByFb: Row[] = latest.length ? await this.db.feedbackCase.findMany({ where: { tenantId, feedbackId: { in: latest.map((f: Row) => f.id) } }, select: { id: true, feedbackId: true, status: true, dueAt: true, wonBack: true } }) : [];
    const goal = coaching.find((c: Row) => c.kind === 'GOAL' && c.goalUntil && new Date(c.goalUntil) > now) ?? null;
    const n = names.get(staffId);

    return {
      staff: { id: staff.id, name: n?.name ?? staff.firstName, initials: n?.initials ?? '?', avatarUrl: staff.avatarUrl ?? null, since: staff.createdAt, active: staff.isActive !== false },
      range: { from: rg.fromKey, to: rg.toKey },
      kpis: {
        answers: mine.length, happy, pct: pct(happy, mine.length), salonPct: pct(salonHappy, inRange.length),
        trendDelta: (() => { const w = myTrend.map((x) => x.pct).filter((x): x is number => x !== null); return w.length >= 2 ? w[w.length - 1] - w[Math.max(0, w.length - 8)] : null; })(),
        rank: rank >= 0 ? rank + 1 : null, ranked: lines.length,
        google: mine.filter((r) => r.toGoogle).length, googleOfHappy: pct(mine.filter((r) => r.toGoogle).length, happy),
        cases: cases.length, overdue: cases.filter((c: Row) => isOverdue(c as { status: string; dueAt: Date }, now)).length, wonBack: cases.filter((c: Row) => c.wonBack === true).length,
        needsAttention: techFlags(this.toRows(all.filter((f: Row) => f.createdAt >= new Date(now.getTime() - s.alertWindowDays * 86_400_000)), tz), s.alertSameReason).some((f) => f.staffId === staffId),
      },
      trend: myTrend.map((w, i) => ({ week: w.week, pct: w.pct, salon: salonTrend[i].pct, answers: w.answers })),
      reasons: reasonCounts(mine),
      pattern,
      latest: latest.map((f: Row) => {
        const r = reqs.find((x) => x.id === f.requestId); const c = caseByFb.find((x) => x.feedbackId === f.id);
        return {
          id: f.id, createdAt: f.createdAt, sentiment: f.sentiment, reasons: f.reasons ?? [], comment: f.comment, toGoogle: !!f.invitedToGoogle,
          customerName: r?.customerName ?? 'Customer', service: Array.isArray(r?.serviceNames) ? r!.serviceNames.join(', ') : null,
          case: c ? { id: c.id, status: c.status, overdue: isOverdue(c as { status: string; dueAt: Date }, now), wonBack: c.wonBack === true } : null,
        };
      }),
      coaching: coaching.map((c: Row) => ({ id: c.id, kind: c.kind, text: c.text, goalPct: c.goalPct, goalUntil: c.goalUntil, byName: c.byName, createdAt: c.createdAt })),
      goal: goal ? { pct: goal.goalPct, until: goal.goalUntil, since: goal.createdAt, text: goal.text } : null,
    };
  }

  async addCoaching(user: AuthenticatedUser, staffId: string, dto: { kind?: string; text?: string; goalPct?: number; goalDays?: number }) {
    const tenantId = this.tenantId(user);
    const staff = await this.db.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { id: true } });
    if (!staff) throw new NotFoundException('Technician not found');
    const kind = ['NOTE', 'GOAL', 'PRAISE'].includes(String(dto.kind)) ? String(dto.kind) : 'NOTE';
    const text = String(dto.text ?? '').trim().slice(0, 600);
    if (!text && kind !== 'GOAL') throw new BadRequestException('Write something first');
    const goalPct = kind === 'GOAL' ? Math.min(100, Math.max(50, Math.round(Number(dto.goalPct) || 90))) : null;
    const days = Math.min(120, Math.max(7, Math.round(Number(dto.goalDays) || 30)));
    const by = await this.byName(user);
    const row = await this.db.staffCoaching.create({
      data: { tenantId, staffId, kind, text: text || `Back to ${goalPct}% happy`, goalPct, goalUntil: kind === 'GOAL' ? new Date(Date.now() + days * 86_400_000) : null, byUserId: user.userId, byName: by },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'feedback.coaching_added', resourceType: 'staff', resourceId: staffId, metadata: { kind } });
    return row;
  }

  private async byName(user: AuthenticatedUser): Promise<string> {
    const u = await this.db.user.findUnique({ where: { id: user.userId }, select: { firstName: true, email: true } }).catch(() => null);
    return u?.firstName || (u?.email ? String(u.email).split('@')[0] : 'Staff');
  }

  // ------------------------------------------------------------------ cases

  async listCases(user: AuthenticatedUser, q: { status?: string; staffId?: string; search?: string }) {
    const tenantId = this.tenantId(user);
    const where: Row = { tenantId };
    if (q.status === 'open') where.status = { in: ['NEW', 'IN_PROGRESS'] };
    else if (q.status === 'contacted') where.status = 'CONTACTED';
    else if (q.status === 'resolved') where.status = 'RESOLVED';
    if (q.staffId) where.staffId = q.staffId;
    const list: Row[] = await this.db.feedbackCase.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 200, select: { id: true } });
    let heads = await this.caseHeads(tenantId, list.map((c) => c.id));
    if (q.search) {
      const s = q.search.toLowerCase();
      heads = heads.filter((h) => `${h.customerName} ${h.staffName ?? ''} ${h.service ?? ''}`.toLowerCase().includes(s));
    }
    const counts: Row[] = await this.db.feedbackCase.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }).catch(() => []);
    const c = (st: string[]) => counts.filter((x) => st.includes(x.status)).reduce((a, x) => a + (x._count?._all ?? 0), 0);
    // Overdue first, then the clock.
    heads.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.status === 'RESOLVED' ? 1 : 0) - (b.status === 'RESOLVED' ? 1 : 0) || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    return { cases: heads, counts: { open: c(['NEW', 'IN_PROGRESS']), contacted: c(['CONTACTED']), resolved: c(['RESOLVED']), all: c(CASE_STATUSES) } };
  }

  async getCase(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const c = await this.db.feedbackCase.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Case not found');
    const [f, events, tenant] = await Promise.all([
      this.db.feedback.findFirst({ where: { id: c.feedbackId, tenantId } }),
      this.db.feedbackCaseEvent.findMany({ where: { tenantId, caseId: id }, orderBy: { createdAt: 'asc' } }),
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, market: true } }),
    ]);
    const req = f?.requestId ? await this.db.feedbackRequest.findFirst({ where: { id: f.requestId, tenantId } }) : null;
    let customer: Row | null = null; let visits = 0; let spentCents = 0; let next: Row | null = null;
    if (c.customerId) {
      customer = await this.db.customer.findFirst({ where: { id: c.customerId, tenantId }, select: { id: true, firstName: true, lastName: true, phone: true } });
      const agg = await this.db.order.aggregate({ where: { tenantId, customerId: c.customerId, status: 'PAID' }, _count: { _all: true }, _sum: { totalCents: true } }).catch(() => null);
      visits = agg?._count?._all ?? 0; spentCents = agg?._sum?.totalCents ?? 0;
      next = await this.db.appointment.findFirst({ where: { tenantId, customerId: c.customerId, startTime: { gt: new Date() }, status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'] } }, orderBy: { startTime: 'asc' }, select: { startTime: true } }).catch(() => null);
    }
    const staff = c.staffId ? await this.db.staffMember.findFirst({ where: { id: c.staffId, tenantId }, select: { firstName: true, lastName: true } }) : null;
    const lang = this.langFor(tenant?.market);
    const me = await this.byName(user);
    const firstName = customer?.firstName ?? (req?.customerName ? String(req.customerName).split(' ')[0] : null);
    const suggestion = suggestFix({ reasons: Array.isArray(f?.reasons) ? f!.reasons : [], visits, firstName, salonName: tenant?.name ?? 'the salon', senderName: me, techName: staff?.firstName ?? null, lang });
    return {
      id: c.id, status: c.status, dueAt: c.dueAt, overdue: isOverdue(c, new Date()), createdAt: c.createdAt,
      assigneeName: c.assigneeName, firstResponseAt: c.firstResponseAt, resolvedAt: c.resolvedAt, resolution: c.resolution, note: c.note, wonBack: c.wonBack,
      customer: {
        name: customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') : (req?.customerName ?? 'Customer'),
        phone: customer?.phone ?? req?.phone ?? null, wantsContact: !!f?.wantsContact,
        visits, spentCents, nextVisit: next?.startTime ?? null,
      },
      staffName: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(' ') : null,
      staffId: c.staffId,
      service: Array.isArray(req?.serviceNames) ? req!.serviceNames.join(', ') : null,
      visitAt: req?.visitAt ?? c.createdAt,
      source: f?.source ?? null,
      feedback: { reasons: f?.reasons ?? [], comment: f?.comment ?? null, photoUrl: f?.photoUrl ?? null },
      suggestion,
      events: events.map((e: Row) => ({ id: e.id, kind: e.kind, byName: e.byName, text: e.text, createdAt: e.createdAt })),
    };
  }

  /**
   * Everything the owner does with a case. Each action is one event on the
   * timeline and one audit row; the first contact stops the clock.
   */
  async caseAction(user: AuthenticatedUser, id: string, dto: { action: string; text?: string; resolution?: string }) {
    const tenantId = this.tenantId(user);
    const c = await this.db.feedbackCase.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Case not found');
    const by = await this.byName(user);
    const now = new Date();
    const text = dto.text ? String(dto.text).trim().slice(0, 1000) : null;
    const data: Row = {};
    let kind = dto.action;
    const contact = () => { if (!c.firstResponseAt) data.firstResponseAt = now; if (c.status === 'NEW' || c.status === 'IN_PROGRESS') data.status = 'CONTACTED'; };

    switch (dto.action) {
      case 'take':
        data.assigneeUserId = user.userId; data.assigneeName = by; if (c.status === 'NEW') data.status = 'IN_PROGRESS'; kind = 'taken'; break;
      case 'contacted':
        contact(); kind = 'status'; break;
      case 'call': case 'free_fix': case 'discount': case 'refund':
        contact(); break;
      case 'send_text': {
        if (!text) throw new BadRequestException('Write the message first');
        const f = await this.db.feedback.findFirst({ where: { id: c.feedbackId, tenantId }, select: { requestId: true } });
        const req = f?.requestId ? await this.db.feedbackRequest.findFirst({ where: { id: f.requestId, tenantId }, select: { phone: true } }) : null;
        const cust = c.customerId ? await this.db.customer.findFirst({ where: { id: c.customerId, tenantId }, select: { phone: true } }) : null;
        const phone = cust?.phone ?? req?.phone ?? null;
        if (!phone || !this.notifications) throw new BadRequestException('No mobile number on file for this customer');
        await this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: phone, body: text, relatedType: 'feedback_case', relatedId: c.id });
        contact(); kind = 'text_sent'; break;
      }
      case 'note':
        if (!text) throw new BadRequestException('Write the note first');
        data.note = text; break;
      case 'resolve':
        data.status = 'RESOLVED'; data.resolvedAt = now; data.resolution = dto.resolution ? String(dto.resolution).slice(0, 120) : (c.resolution ?? null); if (!c.firstResponseAt) data.firstResponseAt = now; kind = 'resolved'; break;
      case 'reopen':
        data.status = 'IN_PROGRESS'; data.resolvedAt = null; kind = 'status'; break;
      default:
        throw new BadRequestException('Unknown action');
    }
    if (!c.assigneeUserId && dto.action !== 'note') { data.assigneeUserId = user.userId; data.assigneeName = by; }
    if (['free_fix', 'discount', 'refund'].includes(dto.action)) data.resolution = { free_fix: 'Free fix', discount: 'Discount next visit', refund: 'Refund' }[dto.action as 'free_fix'];
    if (Object.keys(data).length) await this.db.feedbackCase.updateMany({ where: { id, tenantId }, data });
    await this.db.feedbackCaseEvent.create({ data: { tenantId, caseId: id, kind, byUserId: user.userId, byName: by, text: dto.action === 'send_text' ? text : text ?? (data.status ? `→ ${data.status}` : null) } });
    await this.audit.log({ tenantId, userId: user.userId, action: `feedback.case_${dto.action}`, resourceType: 'feedback_case', resourceId: id, metadata: { status: data.status ?? c.status } });
    return this.getCase(user, id);
  }

  async openCount(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const open: Row[] = await this.db.feedbackCase.findMany({ where: { tenantId, status: { in: ['NEW', 'IN_PROGRESS'] } }, select: { status: true, dueAt: true } }).catch(() => []);
    const now = new Date();
    return { open: open.length, overdue: open.filter((c) => isOverdue(c as { status: string; dueAt: Date }, now)).length };
  }

  /** A technician's own numbers — no customer names, only what the owner allows. */
  async mine(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    const staff = await this.db.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    if (!staff) throw new ForbiddenException('No technician profile');
    if (!s.enabled || !s.techSeeOwnScore) return { visible: false };
    const tz = await this.tzOf(tenantId);
    const rg = this.range(tz, undefined, undefined, 30);
    const list: Row[] = await this.db.feedback.findMany({ where: { tenantId, staffId: staff.id, sentiment: { not: null }, createdAt: { gte: rg.start, lt: rg.end } }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } });
    const rows = this.toRows(list, tz);
    const happy = rows.filter((r) => r.sentiment === 'HAPPY').length;
    // The team board, only when the owner switched it on: first names and
    // percentages, never a customer. Three answers before anyone is ranked.
    let board: { name: string; pct: number | null; answers: number; me: boolean }[] | null = null;
    if (s.techLeaderboard) {
      const all: Row[] = await this.db.feedback.findMany({ where: { tenantId, sentiment: { not: null }, createdAt: { gte: rg.start, lt: rg.end } }, select: { createdAt: true, sentiment: true, staffId: true, reasons: true, invitedToGoogle: true } });
      const names = await this.staffNames(tenantId);
      board = staffLines(this.toRows(all, tz)).filter((l) => l.answers >= 3)
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.answers - a.answers)
        .map((l) => ({ name: (names.get(l.staffId)?.name ?? '').split(' ')[0] || '—', pct: l.pct, answers: l.answers, me: l.staffId === staff.id }));
    }
    return { visible: true, answers: rows.length, happy, pct: pct(happy, rows.length), google: rows.filter((r) => r.toGoogle).length, reasons: s.techSeeReasons ? reasonCounts(rows) : null, board };
  }
}

/** The salon's own email connection (Brevo / Gmail / SMTP), same mapping the booking emails use. */
function emailTransport(n: Row | null, salon: string): Row {
  if (!n) return {};
  const senderName = n.senderName || salon;
  const replyTo = n.replyTo || n.senderEmail || undefined;
  const smtp = n.smtp?.user && n.smtp?.pass
    ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: n.replyTo || undefined, from: `${senderName} <${n.senderEmail || n.smtp.user}>` }
    : undefined;
  const brevo = n.brevo?.apiKey && n.senderEmail
    ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo: n.replyTo || undefined, senderName: n.brevo.senderName || senderName }
    : undefined;
  const gmail = n.gmail?.clientId && n.gmail?.clientSecret && n.gmail?.refreshToken && n.gmail?.senderEmail
    ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName, replyTo }
    : undefined;
  return { smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo };
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * "How was your visit?" by email: the same two buttons as the salon's screen.
 * 😊 opens the Google step, 😕 opens the private note — the email never decides
 * for the customer, and the Google line stays on every path.
 */
export function feedbackEmail(i: { vi: boolean; salon: string; firstName: string | null; tech: string | null; service: string | null; accent: string; link: string }) {
  const L = (vi: string, en: string) => (i.vi ? vi : en);
  const salon = esc(i.salon || L('tiệm', 'the salon'));
  const hi = i.firstName ? L(`Chào ${esc(i.firstName)},`, `Hi ${esc(i.firstName)},`) : L('Xin chào,', 'Hi there,');
  const did = i.tech ? (i.service ? L(`${esc(i.tech)} đã làm ${esc(i.service)} cho bạn hôm nay.`, `${esc(i.tech)} did your ${esc(i.service)} today.`) : L(`${esc(i.tech)} đã phục vụ bạn hôm nay.`, `${esc(i.tech)} looked after you today.`)) : '';
  const happy = `${i.link}?src=email&a=happy`;
  const unhappy = `${i.link}?src=email&a=unhappy`;
  const subject = L(`Hôm nay bạn thấy ${i.salon || 'tiệm'} thế nào?`, `How was your visit to ${i.salon || 'the salon'}?`);
  const btn = (href: string, emoji: string, label: string, bg: string, fg: string, border: string) =>
    `<a href="${href}" style="display:block;text-decoration:none;background:${bg};color:${fg};border:2px solid ${border};border-radius:18px;padding:18px 10px;text-align:center;font-weight:700;font-size:17px"><span style="font-size:34px;display:block;line-height:1.2">${emoji}</span>${label}</a>`;
  const html = `<div style="background:#faf9f7;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e3dd;border-radius:20px;overflow:hidden">`
    + `<div style="background:${i.accent};padding:22px 24px;color:#ffffff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">✦ ${salon}</div>`
    + `<div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;margin-top:6px;line-height:1.2">${L('Hôm nay bạn thấy thế nào?', 'How was your visit today?')}</div></div>`
    + `<div style="padding:22px 24px 8px;color:#1c1917;font-size:15.5px;line-height:1.6">${hi}<br>${L('Cảm ơn bạn đã ghé tiệm.', 'Thank you for coming in.')} ${did}<br>${L('Chỉ một chạm — câu trả lời của bạn gửi thẳng tới chủ tiệm.', 'One tap — your answer goes straight to the owner.')}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:10px 18px 6px"><tr>`
    + `<td width="50%" style="padding:6px">${btn(happy, '😊', L('Hài lòng', 'I’m happy'), '#ecfdf3', '#166534', '#bbf7d0')}</td>`
    + `<td width="50%" style="padding:6px">${btn(unhappy, '😕', L('Chưa hài lòng', 'Not quite'), '#fff4ed', '#9a3412', '#fed7aa')}</td>`
    + `</tr></table>`
    + `<div style="padding:8px 24px 22px;color:#a39d96;font-size:12.5px;line-height:1.5;text-align:center">${L('Góp ý chưa hài lòng chỉ chủ tiệm đọc — tên bạn không hiện cho thợ.', 'A “not quite” is read only by the owner — your name is never shown to the technician.')}</div>`
    + `</div></div>`;
  const text = `${hi.replace(/<[^>]+>/g, '')} ${L('Cảm ơn bạn đã ghé', 'Thank you for visiting')} ${i.salon}. ${L('Hôm nay bạn thấy thế nào?', 'How was your visit today?')}\n😊 ${L('Hài lòng', 'I’m happy')}: ${happy}\n😕 ${L('Chưa hài lòng', 'Not quite')}: ${unhappy}`;
  return { subject, html, text };
}

