import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { bookingUrl } from '../common/public-url.util';
import {
  CAMPAIGN_SETTINGS_KEY,
  CampaignKey,
  CampaignMessage,
  CampaignSettings,
  DEFAULT_CAMPAIGN_SETTINGS,
  LapsedCampaign,
  campaignRelatedType,
} from './campaigns.constants';

const DAY = 86_400_000;
const SEND_CAP_PER_RUN = 300; // safety cap so a misconfig can't blast the whole list

type CustomerRow = { id: string; firstName: string; email: string | null; phone: string | null; smsConsent: boolean };

function fillPct(template: string, data: Record<string, string>): string {
  return template.replace(/%(\w+)%/g, (_m, k: string) => (data[k] == null ? '' : String(data[k])));
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function bodyToHtml(text: string): string {
  const parts = text.split('\n').map((l) => (l.trim() ? `<p style="margin:0 0 10px">${escapeHtml(l)}</p>` : '')).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#374151">${parts}</div>`;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger('Campaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Read a tenant's campaign settings, merged over defaults. */
  async getForTenant(tenantId: string): Promise<CampaignSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: CAMPAIGN_SETTINGS_KEY } } });
    const stored = (row?.value as Partial<CampaignSettings>) ?? {};
    const d = DEFAULT_CAMPAIGN_SETTINGS;
    const mergeMsg = (cur: CampaignMessage, patch?: Partial<CampaignMessage>): CampaignMessage => ({ ...cur, ...(patch ?? {}) });
    return {
      sendHour: typeof stored.sendHour === 'number' ? Math.min(23, Math.max(0, stored.sendHour)) : d.sendHour,
      winBack: { ...mergeMsg(d.winBack, stored.winBack), daysSince: this.posInt(stored.winBack?.daysSince, d.winBack.daysSince) },
      reactivation: { ...mergeMsg(d.reactivation, stored.reactivation), daysSince: this.posInt(stored.reactivation?.daysSince, d.reactivation.daysSince) },
      birthday: mergeMsg(d.birthday, stored.birthday),
    };
  }

  async getSettings(user: AuthenticatedUser): Promise<CampaignSettings> {
    return this.getForTenant(this.tid(user));
  }

  /** Salon Admin updates campaign settings. Validates + clamps, then persists. */
  async updateSettings(
    user: AuthenticatedUser,
    dto: { sendHour?: number; winBack?: Partial<LapsedCampaign>; reactivation?: Partial<LapsedCampaign>; birthday?: Partial<CampaignMessage> },
  ): Promise<CampaignSettings> {
    const tenantId = this.tid(user);
    const cur = await this.getForTenant(tenantId);
    const msg = (c: CampaignMessage, p?: Partial<CampaignMessage>): CampaignMessage => ({
      enabled: typeof p?.enabled === 'boolean' ? p.enabled : c.enabled,
      email: typeof p?.email === 'boolean' ? p.email : c.email,
      sms: typeof p?.sms === 'boolean' ? p.sms : c.sms,
      subject: typeof p?.subject === 'string' ? p.subject : c.subject,
      body: typeof p?.body === 'string' ? p.body : c.body,
      smsBody: typeof p?.smsBody === 'string' ? p.smsBody : c.smsBody,
    });
    const next: CampaignSettings = {
      sendHour: typeof dto.sendHour === 'number' ? Math.min(23, Math.max(0, Math.round(dto.sendHour))) : cur.sendHour,
      winBack: { ...msg(cur.winBack, dto.winBack), daysSince: this.posInt(dto.winBack?.daysSince, cur.winBack.daysSince) },
      reactivation: { ...msg(cur.reactivation, dto.reactivation), daysSince: this.posInt(dto.reactivation?.daysSince, cur.reactivation.daysSince) },
      birthday: msg(cur.birthday, dto.birthday),
    };
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: CAMPAIGN_SETTINGS_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: CAMPAIGN_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** Sends counted per campaign over the last 30 days (for the admin dashboard). */
  async getStats(user: AuthenticatedUser): Promise<Record<CampaignKey, number>> {
    const tenantId = this.tid(user);
    const since = new Date(Date.now() - 30 * DAY);
    const keys: CampaignKey[] = ['winBack', 'reactivation', 'birthday'];
    const rows = await this.prisma.notification.groupBy({
      by: ['relatedType'],
      where: { tenantId, createdAt: { gte: since }, relatedType: { in: keys.map(campaignRelatedType) } },
      _count: { _all: true },
    });
    const out: Record<CampaignKey, number> = { winBack: 0, reactivation: 0, birthday: 0 };
    for (const k of keys) {
      const r = rows.find((x) => x.relatedType === campaignRelatedType(k));
      out[k] = r?._count._all ?? 0;
    }
    return out;
  }

  /** Manual trigger (testing) — runs the tenant's enabled campaigns now, ignoring the send-hour gate. */
  async runNow(user: AuthenticatedUser): Promise<Record<CampaignKey, number>> {
    return this.runForTenant(this.tid(user), true);
  }

  /**
   * Send a SAMPLE of one campaign's message to the admin's own email/phone so they
   * can see the template + confirm delivery works — without waiting for a real
   * eligible customer. Ignores targeting/consent/dedup (it's a self-test). Returns
   * a per-channel status ('sent' | 'skipped' | 'error: …') so the UI can show why.
   */
  async testSend(
    user: AuthenticatedUser,
    dto: { campaign: CampaignKey; email?: string; phone?: string },
  ): Promise<{ email: string; sms: string }> {
    const tenantId = this.tid(user);
    const cs = await this.getForTenant(tenantId);
    const msg = cs[dto.campaign] as CampaignMessage;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, contactEmail: true, contactPhone: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const n = await this.settings.getNotificationSettings(tenantId);
    const transport = this.buildTransport(n, tenant.name);
    const pct: Record<string, string> = {
      salon_name: tenant.name,
      salon_contact: tenant.contactPhone || tenant.contactEmail || '',
      booking_link: bookingUrl(tenant.slug),
      customer_name: 'Test',
    };
    const out = { email: 'skipped', sms: 'skipped' };

    const email = (dto.email ?? '').trim();
    if (email) {
      const bodyText = fillPct(msg.body, pct);
      const rec = await this.notifications.send({
        tenantId, channel: NotificationChannel.EMAIL, recipient: email,
        subject: `[TEST] ${fillPct(msg.subject, pct)}`, body: bodyText, html: bodyToHtml(bodyText),
        smtp: transport.smtp, brevo: transport.brevo, gmail: transport.gmail,
        mailService: n.mailService, senderName: transport.senderName, replyTo: transport.replyTo,
        relatedType: 'campaign_test', relatedId: dto.campaign,
      });
      out.email = String(rec.status) === 'SENT' ? 'sent' : `error: ${rec.error || 'failed'}`;
    }

    const phone = (dto.phone ?? '').trim();
    if (phone) {
      const rec = await this.notifications.send({
        tenantId, channel: NotificationChannel.SMS, recipient: phone,
        body: `[TEST] ${fillPct(msg.smsBody, pct)}`, relatedType: 'campaign_test', relatedId: dto.campaign,
      });
      out.sms = String(rec.status) === 'SENT' ? 'sent' : `error: ${rec.error || 'failed'}`;
    }
    return out;
  }

  /** Scheduler entry: run every tenant whose campaigns are enabled, respecting each tenant's send hour. */
  async runDue(): Promise<{ sent: number }> {
    const rows = await this.prisma.setting.findMany({ where: { key: CAMPAIGN_SETTINGS_KEY }, select: { tenantId: true } });
    let sent = 0;
    for (const r of rows) {
      try {
        const c = await this.runForTenant(r.tenantId, false);
        sent += c.winBack + c.reactivation + c.birthday;
      } catch (e) {
        this.logger.warn(`Campaign run failed for tenant ${r.tenantId}: ${(e as Error).message}`);
      }
    }
    return { sent };
  }

  // ---- engine -------------------------------------------------------------

  private async runForTenant(tenantId: string, ignoreHour: boolean): Promise<Record<CampaignKey, number>> {
    const counts: Record<CampaignKey, number> = { winBack: 0, reactivation: 0, birthday: 0 };
    const cs = await this.getForTenant(tenantId);
    if (!cs.winBack.enabled && !cs.reactivation.enabled && !cs.birthday.enabled) return counts;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, contactEmail: true, contactPhone: true, timezone: true },
    });
    if (!tenant) return counts;
    const tz = tenant.timezone || 'America/New_York';

    if (!ignoreHour) {
      const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()));
      if (hour !== cs.sendHour) return counts;
    }

    const n = await this.settings.getNotificationSettings(tenantId);
    const transport = this.buildTransport(n, tenant.name);
    const basePct: Record<string, string> = {
      salon_name: tenant.name,
      salon_contact: tenant.contactPhone || tenant.contactEmail || '',
      booking_link: bookingUrl(tenant.slug),
    };
    let used = 0;

    // Lapsed-customer campaigns (win-back, reactivation).
    for (const key of ['winBack', 'reactivation'] as const) {
      const camp = cs[key] as LapsedCampaign;
      if (!camp.enabled || (!camp.email && !camp.sms) || used >= SEND_CAP_PER_RUN) continue;
      const ids = await this.lapsedCustomerIds(tenantId, camp.daysSince);
      if (ids.length === 0) continue;
      const dedupSince = new Date(Date.now() - camp.daysSince * DAY);
      const custs = await this.prisma.customer.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, firstName: true, email: true, phone: true, smsConsent: true } });
      for (const c of custs) {
        if (used >= SEND_CAP_PER_RUN) break;
        if (await this.alreadySent(tenantId, key, c.id, dedupSince)) continue;
        if (await this.sendToCustomer(tenantId, c, camp, key, basePct, transport, n)) { counts[key]++; used++; }
      }
    }

    // Birthday campaign — match today's tenant-local month/day to the stored birthdate.
    if (cs.birthday.enabled && (cs.birthday.email || cs.birthday.sms) && used < SEND_CAP_PER_RUN) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric', day: 'numeric' }).formatToParts(new Date());
      const month = Number(parts.find((p) => p.type === 'month')?.value);
      const day = Number(parts.find((p) => p.type === 'day')?.value);
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const custs = await this.prisma.customer.findMany({ where: { tenantId, birthDate: { not: null } }, select: { id: true, firstName: true, email: true, phone: true, smsConsent: true, birthDate: true } });
      for (const c of custs) {
        if (used >= SEND_CAP_PER_RUN) break;
        const b = c.birthDate!;
        if (b.getUTCMonth() + 1 !== month || b.getUTCDate() !== day) continue;
        if (await this.alreadySent(tenantId, 'birthday', c.id, yearStart)) continue;
        if (await this.sendToCustomer(tenantId, c, cs.birthday, 'birthday', basePct, transport, n)) { counts.birthday++; used++; }
      }
    }

    return counts;
  }

  /** Customers whose most recent COMPLETED visit was ~daysSince ago and who have no later/upcoming appointment. */
  private async lapsedCustomerIds(tenantId: string, daysSince: number): Promise<string[]> {
    const now = Date.now();
    const upper = new Date(now - daysSince * DAY); // last visit must be before this
    const lower = new Date(now - (daysSince + 1) * DAY); // …and after this (a 1-day band, so each customer fires once)
    const grouped = await this.prisma.appointment.groupBy({
      by: ['customerId'],
      where: { tenantId, status: AppointmentStatus.COMPLETED },
      _max: { startTime: true },
    });
    const ids = grouped
      .filter((g) => {
        const last = g._max?.startTime;
        return !!last && last >= lower && last < upper;
      })
      .map((g) => g.customerId);
    if (ids.length === 0) return [];
    // Drop anyone with a later visit or an upcoming booking (they're already returning).
    const later = await this.prisma.appointment.findMany({
      where: { tenantId, customerId: { in: ids }, startTime: { gte: upper } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const laterSet = new Set(later.map((l) => l.customerId));
    return ids.filter((id) => !laterSet.has(id));
  }

  private async alreadySent(tenantId: string, key: CampaignKey, customerId: string, since: Date): Promise<boolean> {
    const n = await this.prisma.notification.findFirst({
      where: { tenantId, relatedType: campaignRelatedType(key), relatedId: customerId, createdAt: { gte: since } },
      select: { id: true },
    });
    return !!n;
  }

  /** Send one customer their campaign message. SMS requires explicit consent; email requires an address. Returns true if anything was sent. */
  private async sendToCustomer(
    tenantId: string,
    c: CustomerRow,
    msg: CampaignMessage,
    key: CampaignKey,
    basePct: Record<string, string>,
    transport: ReturnType<CampaignsService['buildTransport']>,
    n: Awaited<ReturnType<SettingsService['getNotificationSettings']>>,
  ): Promise<boolean> {
    const pct = { ...basePct, customer_name: c.firstName || 'there' };
    const related = { relatedType: campaignRelatedType(key), relatedId: c.id };
    const jobs: Promise<unknown>[] = [];
    if (msg.email && c.email) {
      const bodyText = fillPct(msg.body, pct);
      jobs.push(this.notifications.send({
        tenantId, channel: NotificationChannel.EMAIL, recipient: c.email,
        subject: fillPct(msg.subject, pct), body: bodyText, html: bodyToHtml(bodyText),
        smtp: transport.smtp, brevo: transport.brevo, gmail: transport.gmail,
        mailService: n.mailService, senderName: transport.senderName, replyTo: transport.replyTo, ...related,
      }));
    }
    if (msg.sms && c.phone && c.smsConsent) {
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: c.phone, body: fillPct(msg.smsBody, pct), ...related }));
    }
    if (jobs.length === 0) return false;
    await Promise.allSettled(jobs);
    return true;
  }

  /** Build the salon's email transport (Gmail/Brevo/SMTP) from its notification settings. */
  private buildTransport(n: Awaited<ReturnType<SettingsService['getNotificationSettings']>>, salonName: string) {
    const senderName = n.senderName || salonName || 'Our salon';
    const replyTo = n.replyTo || n.senderEmail || undefined;
    const smtp = n.smtp.user && n.smtp.pass
      ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: n.replyTo || undefined, from: `${senderName} <${n.senderEmail || n.smtp.user}>` }
      : undefined;
    const brevo = n.brevo.apiKey && n.senderEmail
      ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo: n.replyTo || undefined, senderName: n.brevo.senderName || senderName }
      : undefined;
    const gmail = n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
      ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName, replyTo }
      : undefined;
    return { senderName, replyTo, smtp, brevo, gmail };
  }

  private posInt(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  }
}
