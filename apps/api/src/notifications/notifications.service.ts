import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { heldReasonFor, isOptOut, maySendSms, smsPolicyFor, type MessageKind } from './sms-policy';
import { dialCodeFor } from '../common/phone';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { EmailProvider, SmsProvider } from './providers/notification-provider.interface';
import { createEmailProvider, createSmsProvider } from './providers/notification-provider.factory';
import { ESmsProvider } from './providers/esms.provider';
import { twilioSenderFor, vnEsmsFor, platformEsmsFromEnv } from './providers/sms-routing';
import { readEsmsCallback } from './providers/esms-callback';
import { ZnsProvider } from './providers/zns.provider';
import { SmtpConfig, SmtpEmailProvider } from './providers/smtp.provider';
import { BrevoConfig, BrevoEmailProvider } from './providers/brevo.provider';
import { GmailOAuthConfig, GmailOAuthProvider } from './providers/gmail-oauth.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';

/** Build a platform Gmail-OAuth provider from env vars, or null if not configured. */
function envGmailProvider(senderName?: string, replyTo?: string): GmailOAuthProvider | null {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  if (!clientId || !clientSecret || !refreshToken || !senderEmail) return null;
  return new GmailOAuthProvider({
    clientId,
    clientSecret,
    refreshToken,
    senderEmail,
    senderName: senderName || process.env.GMAIL_SENDER_NAME || 'Lumio Booking',
    replyTo,
  });
}

/** Public base URL of THIS api, for provider callbacks. Same resolution order
 *  as webhook-signatures.ts, so eSMS and Twilio agree on what our address is. */
function apiBase(): string {
  return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
}

/** Extracts the display name from a "Name <email>" string. */
function parseSenderName(from?: string): string {
  if (!from) return '';
  const m = from.match(/^\s*(.+?)\s*</);
  return m ? m[1] : '';
}

export interface SendNotificationInput {
  tenantId: string;
  channel: NotificationChannel;
  recipient: string;
  /**
   * Whether this message is a receipt or an advert. Transactional (the
   * default, and what every existing caller gets) is never held back — a
   * 10pm booking that gets no confirmation until 7am is a broken product.
   * Marketing goes through the market's quiet-hours and daily-cap rules.
   */
  kind?: MessageKind;
  subject?: string;
  body: string;
  html?: string;
  relatedType?: string;
  relatedId?: string;
  // When provided for an EMAIL, deliver over the salon's own SMTP (real email)
  // instead of the mock provider.
  smtp?: SmtpConfig;
  // The salon's own Brevo HTTPS config (preferred over SMTP when present).
  brevo?: BrevoConfig;
  // The salon's own Gmail OAuth2 config (Gmail API over HTTPS).
  gmail?: GmailOAuthConfig;
  /**
   * Ask for Zalo ZNS first, SMS as the net. Only honoured for a VN salon whose
   * eSMS config carries an OAID and the matching template id; everyone else —
   * and every failure — takes exactly the SMS path they take today. `params`
   * must match the registered ZNS template's parameter names (Lumio canon:
   * customer_name, salon_name, service_name, appointment_date, appointment_time).
   */
  zns?: { kind: 'booking_confirmed' | 'reminder'; params: Record<string, string> };
  // The salon's own Twilio SMS credentials (per-tenant). When complete, SMS is
  // sent from the salon's own number; otherwise it falls back to the platform
  // (env) Twilio, then mock.
  twilio?: { accountSid: string; authToken: string; fromNumber?: string; messagingServiceSid?: string };
  // Explicit delivery choice (Amelia-style). When set, it wins over auto-detection.
  mailService?: 'auto' | 'off' | 'smtp' | 'brevo' | 'gmail';
  // Used by the platform-email (Auto) path so the customer sees the SALON's name
  // and replies route back to the salon.
  senderName?: string;
  replyTo?: string;
}

/**
 * Sends notifications via the configured provider AND records every one in the
 * notifications table (tenant-scoped), so a salon has a full delivery history.
 * Sending never throws to the caller: failures are recorded with FAILED status.
 */
@Injectable()
export class NotificationsService {
  private readonly email: EmailProvider = createEmailProvider();
  private readonly sms: SmsProvider = createSmsProvider();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send ONE email through exactly the same provider chain as send(), but WITHOUT
   * writing a notifications row. Bulk email marketing keeps its own outbox
   * (email_campaign_recipients) — otherwise a 500-recipient blast would bury the
   * salon's booking confirmations in their notification history.
   */
  async sendEmailRaw(input: SendNotificationInput): Promise<{ success: boolean; error?: string; provider: string }> {
    const provider = this.emailProviderFor(input);
    try {
      const r = await provider.sendEmail({
        to: input.recipient,
        subject: input.subject ?? '',
        body: input.body,
        html: input.html,
      });
      return { success: !!r.success, error: r.error ?? undefined, provider: provider.name };
    } catch (err) {
      return { success: false, error: String(err), provider: provider.name };
    }
  }

  /** Email provider preference (per salon), shared by send() and sendEmailRaw(). */
  private emailProviderFor(input: SendNotificationInput): EmailProvider {
    const svc = input.mailService;
    const brevoReady = !!(input.brevo?.apiKey && input.brevo?.senderEmail);
    const smtpReady = !!(input.smtp?.user && input.smtp?.pass);
    const gmailReady = !!(input.gmail?.clientId && input.gmail?.clientSecret && input.gmail?.refreshToken && input.gmail?.senderEmail);
    if (svc === 'brevo' && brevoReady) return new BrevoEmailProvider(input.brevo!);
    if (svc === 'smtp' && smtpReady) return new SmtpEmailProvider(input.smtp!);
    if (svc === 'gmail' && gmailReady) return new GmailOAuthProvider(input.gmail!);
    if (svc === 'off') return this.email;
    if (gmailReady) return new GmailOAuthProvider(input.gmail!);
    if (brevoReady) return new BrevoEmailProvider(input.brevo!);
    if (smtpReady) return new SmtpEmailProvider(input.smtp!);
    const gmail = envGmailProvider(
      input.senderName || parseSenderName(input.smtp?.from),
      input.replyTo || input.smtp?.replyTo || input.brevo?.replyTo,
    );
    if (gmail) return gmail;
    const envKey = process.env.BREVO_API_KEY;
    const envSender = process.env.BREVO_SENDER_EMAIL;
    if (envKey && envSender) {
      const name = input.senderName || parseSenderName(input.smtp?.from) || process.env.BREVO_SENDER_NAME || 'Lumio Booking';
      const replyTo = input.replyTo || input.smtp?.replyTo || input.brevo?.replyTo;
      return new BrevoEmailProvider({ apiKey: envKey, senderEmail: envSender, senderName: name, replyTo });
    }
    return this.email;
  }

  /**
   * Which SMS network this salon's messages go out on.
   *
   * Resolved HERE, from the tenant id, rather than passed in by the caller.
   * Ten call sites send an SMS, and each would otherwise have to remember to
   * pass the eSMS keys — nine remembering and one forgetting looks like a
   * working feature and is a Vietnamese salon whose messages the carrier
   * silently drops. One lookup cannot be forgotten.
   *
   * Never throws: any failure returns null and the existing Twilio path runs,
   * which is what every salon does today.
   */
  /** Market + hotline number, for choosing the Twilio sender. Never throws. */
  private async twilioSenderForTenant(tenantId: string) {
    try {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } as never }) as { market?: string | null } | null;
      const market = String(t?.market ?? 'US').toUpperCase();
      if (market !== 'AU' && market !== 'VN') return { kind: 'default' as const };
      const line = market === 'AU'
        ? await (this.prisma as unknown as { voiceLine?: { findUnique: (a: unknown) => Promise<{ lumioNumber?: string | null } | null> } })
          .voiceLine?.findUnique({ where: { tenantId }, select: { lumioNumber: true } }).catch(() => null)
        : null;
      return twilioSenderFor({ market, lineNumber: line?.lumioNumber ?? null, auFallback: process.env.TWILIO_FROM_NUMBER_AU ?? null });
    } catch {
      return { kind: 'default' as const };
    }
  }

  private async esmsForTenant(tenantId: string): Promise<{ apiKey: string; secretKey: string; brandname: string; callbackUrl: string; oaid: string; znsBookingTempId: string; znsReminderTempId: string } | null> {
    try {
      const [t, row] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } as never }),
        this.prisma.setting.findFirst({ where: { tenantId, key: 'notifications' }, select: { value: true } }).catch(() => null),
      ]);
      const market = (t as unknown as { market?: string } | null)?.market ?? 'US';
      const esms = (row?.value as unknown as { esms?: { apiKey?: string; secretKey?: string; brandname?: string; oaid?: string; znsBookingTempId?: string; znsReminderTempId?: string } } | null)?.esms;
      // The salon's own eSMS when complete, else Lumio's shared Zalo OA /
      // brandname from the environment — see vnEsmsFor.
      const cfg = vnEsmsFor({ market, salon: esms ?? null, platform: platformEsmsFromEnv() });
      if (!cfg) return null;
      return {
        apiKey: cfg.apiKey,
        secretKey: cfg.secretKey,
        brandname: cfg.brandname,
        // CodeResult 100 only means "accepted" — the real delivery outcome
        // arrives HERE, so every send carries the address of our callback.
        callbackUrl: `${apiBase()}/api/public/esms/callback`,
        oaid: cfg.oaid,
        znsBookingTempId: cfg.znsBookingTempId,
        znsReminderTempId: cfg.znsReminderTempId,
      };
    } catch {
      return null;
    }
  }

  /** Country calling code for a tenant, read from its timezone. Failures fall
   *  back to '1', i.e. exactly the behaviour before this existed. */
  private async dialCodeForTenant(tenantId: string): Promise<string> {
    try {
      const [t, extra] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
        this.prisma.setting
          .findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } })
          .catch(() => null),
      ]);
      const country = (extra?.value as { country?: string } | null)?.country ?? '';
      return dialCodeFor(country, t?.timezone);
    } catch {
      return '1';
    }
  }

  /**
   * The quiet-hours and per-number gate for advertising SMS. The rules have
   * lived, fully tested, in sms-policy.ts since the day Vietnam support was
   * written — and nothing called them, so a birthday campaign could still fire
   * at 2am Hanoi. This is the missing caller. A held message is recorded as
   * FAILED with the reason, because a campaign that silently sends nothing
   * looks exactly like a campaign with no eligible customers.
   */
  private async marketingSmsGate(input: SendNotificationInput) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { timezone: true, market: true } as never,
    }).catch(() => null) as { timezone?: string; market?: string | null } | null;
    const market = tenant?.market ?? null;
    const policy = smsPolicyFor(market);
    if (!policy.adHoursLocal && policy.adPerDayCap === null) return { held: null, policy }; // US/CA: unchanged, by design

    // NĐ91's first condition, before any clock: advertising goes only to
    // someone who agreed in advance. The campaign engine filters on
    // smsConsent, but rebooking nudges (and any future caller) do not — this
    // is the net under all of them. Only rows whose recipient matches a known
    // customer are judged; an unknown number passes through to the hour/cap
    // rules exactly as before. US/CA never reach this method at all.
    const cust = await this.prisma.customer.findFirst({
      where: { tenantId: input.tenantId, phone: input.recipient },
      select: { smsConsent: true },
    }).catch(() => null);
    if (cust && cust.smsConsent === false) {
      const held = await this.prisma.notification.create({
        data: {
          tenantId: input.tenantId,
          channel: input.channel,
          recipient: input.recipient,
          subject: input.subject ?? null,
          body: input.body,
          status: NotificationStatus.FAILED,
          provider: 'sms-policy',
          error: heldReasonFor(market, 'no-consent'),
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          sentAt: null,
        },
      });
      return { held, policy };
    }

    let nowMinutesLocal = 12 * 60; // an unreadable clock must not block a send outright
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tenant?.timezone || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date());
      const g = (t: string) => Number(parts.find((x) => x.type === t)?.value);
      const h = g('hour') === 24 ? 0 : g('hour');
      if (Number.isFinite(h) && Number.isFinite(g('minute'))) nowMinutesLocal = h * 60 + g('minute');
    } catch { /* keep the midday default */ }

    const prior = await this.prisma.notification.findMany({
      where: {
        tenantId: input.tenantId,
        channel: NotificationChannel.SMS,
        recipient: input.recipient,
        status: NotificationStatus.SENT,
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        OR: [{ relatedType: { startsWith: 'campaign:' } }, { relatedType: 'rebooking' }],
      },
      select: { sentAt: true },
      take: 20,
    }).catch(() => [] as { sentAt: Date | null }[]);

    const verdict = maySendSms({
      market, kind: 'marketing', nowMinutesLocal,
      sentAt: prior.map((r) => r.sentAt).filter((d): d is Date => Boolean(d)),
    });
    if (verdict.ok) return { held: null, policy };
    const held = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject ?? null,
        body: input.body,
        status: NotificationStatus.FAILED,
        provider: 'sms-policy',
        error: heldReasonFor(market, verdict.reason),
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        sentAt: null,
      },
    });
    return { held, policy };
  }

  async send(input: SendNotificationInput) {
    let status: NotificationStatus = NotificationStatus.PENDING;
    let error: string | null = null;
    // The row's id is chosen BEFORE the provider call so it can double as the
    // provider's idempotency key (eSMS RequestId): if anything retries this
    // send, the customer still gets at most one text.
    const rowId = randomUUID();
    let providerMessageId: string | null = null;

    // Adverts pass through the market's rules before any provider is chosen.
    if (input.channel === NotificationChannel.SMS && input.kind === 'marketing') {
      const gate = await this.marketingSmsGate(input);
      if (gate?.held) return gate.held;
      // The law that sets the window also demands a stated opt-out, in the
      // customer's language. Only markets WITH a window get the line appended —
      // US salons keep exactly the messages they send today.
      if (gate?.policy.adHoursLocal && !input.body.includes(gate.policy.optOutLine)) {
        input = { ...input, body: `${input.body}\n${gate.policy.optOutLine}` };
      }
    }

    // Email provider preference (per salon): the salon's own Brevo (HTTPS, works
    // from the cloud) > the salon's own SMTP > an optional platform-wide Brevo
    // (env) fallback > mock.
    const emailProvider: EmailProvider = ((): EmailProvider => {
      if (input.channel !== NotificationChannel.EMAIL) return this.email;
      const svc = input.mailService;
      const brevoReady = !!(input.brevo?.apiKey && input.brevo?.senderEmail);
      const smtpReady = !!(input.smtp?.user && input.smtp?.pass);
      const gmailReady = !!(input.gmail?.clientId && input.gmail?.clientSecret && input.gmail?.refreshToken && input.gmail?.senderEmail);
      // Explicit choice wins (no guessing) — this is the Amelia-style behaviour.
      if (svc === 'brevo' && brevoReady) return new BrevoEmailProvider(input.brevo!);
      if (svc === 'smtp' && smtpReady) return new SmtpEmailProvider(input.smtp!);
      if (svc === 'gmail' && gmailReady) return new GmailOAuthProvider(input.gmail!);
      if (svc === 'off') return this.email; // logged only, no real send
      // Auto fallback (svc unset, or chosen provider not configured yet): salon's own
      // Gmail > Brevo > SMTP > platform Gmail (env) > platform Brevo > mock.
      if (gmailReady) return new GmailOAuthProvider(input.gmail!);
      if (brevoReady) return new BrevoEmailProvider(input.brevo!);
      if (smtpReady) return new SmtpEmailProvider(input.smtp!);
      const gmail = envGmailProvider(
        input.senderName || parseSenderName(input.smtp?.from),
        input.replyTo || input.smtp?.replyTo || input.brevo?.replyTo,
      );
      if (gmail) return gmail;
      const envKey = process.env.BREVO_API_KEY;
      const envSender = process.env.BREVO_SENDER_EMAIL;
      if (envKey && envSender) {
        const name = input.senderName || parseSenderName(input.smtp?.from) || process.env.BREVO_SENDER_NAME || 'Lumio Booking';
        const replyTo = input.replyTo || input.smtp?.replyTo || input.brevo?.replyTo;
        return new BrevoEmailProvider({ apiKey: envKey, senderEmail: envSender, senderName: name, replyTo });
      }
      return this.email;
    })();
    // SMS provider (per salon): the salon's own Twilio when its credentials are
    // complete, otherwise the platform env Twilio (or mock). Mirrors the email logic.
    // Vietnam goes through a domestic aggregator, not Twilio. Twilio to a
    // Vietnamese number is a SILENT failure: Twilio accepts the message and
    // returns an id, and the carrier drops it — the salon sees "sent" and the
    // customer receives nothing. The rule is in sms-routing.ts, pinned by tests
    // that a US or CA salon is never routed here even with eSMS keys sitting in
    // its settings.
    const vnKeys = input.channel === NotificationChannel.SMS
      ? await this.esmsForTenant(input.tenantId)
      : null;

    // Outside North America the platform's +1 number is the wrong sender —
    // see twilioSenderFor. Looked up only for an SMS that is going to the
    // platform Twilio account (no eSMS, no salon-owned credentials).
    const ownTwilio = !!(input.twilio?.accountSid && input.twilio?.authToken && (input.twilio.fromNumber || input.twilio.messagingServiceSid));
    // Only when the platform really sends through Twilio: the mock provider
    // used in development and tests keeps accepting everything.
    const sender = input.channel === NotificationChannel.SMS && !vnKeys && !ownTwilio && this.sms.name === 'twilio'
      ? await this.twilioSenderForTenant(input.tenantId)
      : { kind: 'default' as const };

    const smsProvider: SmsProvider = ((): SmsProvider => {
      if (input.channel !== NotificationChannel.SMS) return this.sms;
      if (vnKeys) {
        // Vietnamese law keeps adverts and customer care apart: a CSKH
        // brandname (what this adapter sends on) may not carry promotions,
        // and an advert on it can get the brandname — shared by every VN
        // salon — suspended by the carriers. Adverts need a QC brandname and
        // carrier-approved content; until that channel exists, hold them.
        if (input.kind === 'marketing') {
          return {
            name: 'sms-policy',
            sendSms: async () => ({
              success: false,
              error: 'Chưa gửi: tin quảng cáo ở Việt Nam phải đi brandname quảng cáo (QC) đã duyệt nội dung — không được gửi bằng brandname CSKH. / Not sent: Vietnamese adverts need an approved advertising (QC) brandname.',
            }),
          };
        }
        if (vnKeys.brandname) return new ESmsProvider(vnKeys);
        // Lumio's shared account may be Zalo-only. Without a brandname an
        // SMS is eSMS error 104 every time — say so instead of paying for it.
        return {
          name: 'esms',
          sendSms: async () => ({
            success: false,
            error: 'Chưa gửi: Zalo ZNS không tới được số này và hệ thống chưa có brandname SMS (ESMS_BRANDNAME). / Not sent: Zalo could not reach this number and no SMS brandname is set.',
          }),
        };
      }

      const t = input.twilio;
      if (t?.accountSid && t?.authToken && (t.fromNumber || t.messagingServiceSid)) {
        return new TwilioSmsProvider({
          accountSid: t.accountSid,
          authToken: t.authToken,
          fromNumber: t.fromNumber || undefined,
          messagingServiceSid: t.messagingServiceSid || undefined,
        });
      }
      if (sender.kind === 'refuse') {
        const error = sender.error;
        return { name: 'sms-routing', sendSms: async () => ({ success: false, error }) };
      }
      if (sender.kind === 'from') {
        const sid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim();
        const tok = (process.env.TWILIO_AUTH_TOKEN ?? '').trim();
        if (sid && tok) return new TwilioSmsProvider({ accountSid: sid, authToken: tok, fromNumber: sender.from });
        return { name: 'sms-routing', sendSms: async () => ({ success: false, error: 'Twilio platform credentials are not configured' }) };
      }
      return this.sms;
    })();
    const provider = input.channel === NotificationChannel.EMAIL ? emailProvider : smsProvider;
    let providerName = provider.name;

    try {
      let result: { success: boolean; providerMessageId?: string; error?: string } | null = null;

      if (input.channel === NotificationChannel.EMAIL) {
        result = await emailProvider.sendEmail({
          to: input.recipient,
          subject: input.subject ?? '',
          body: input.body,
          html: input.html,
        });
      } else {
        // Zalo ZNS first, when asked for and configured: cheaper than a
        // brandname SMS and lands inside the app the customer actually reads.
        // ANY failure — no Zalo on that number, template mismatch, eSMS down —
        // falls straight through to the SMS path below, so a customer can
        // lose the discount but never the message.
        if (vnKeys && input.zns) {
          const tempId = input.zns.kind === 'booking_confirmed' ? vnKeys.znsBookingTempId : vnKeys.znsReminderTempId;
          if (vnKeys.oaid && tempId) {
            const zns = new ZnsProvider({
              apiKey: vnKeys.apiKey, secretKey: vnKeys.secretKey,
              oaid: vnKeys.oaid, callbackUrl: vnKeys.callbackUrl,
            });
            // Suffixed idempotency key: if eSMS treats RequestId as global,
            // a failed ZNS try must not make them refuse the SMS fallback
            // as a 24h duplicate (their error 124).
            const zr = await zns.sendZns({ to: input.recipient, tempId, params: input.zns.params, requestId: `${rowId}-z` });
            if (zr.success) {
              result = zr;
              providerName = zns.name;
            }
          }
        }
        if (!result) {
          result = await smsProvider.sendSms({
            to: input.recipient,
            body: input.body,
            // A local number means different things in different countries.
            // The salon's timezone is the only country signal a tenant
            // carries, and it is enough to tell Ho Chi Minh City from
            // Los Angeles. US/CA tenants resolve to '1' — unchanged.
            defaultDialCode: await this.dialCodeForTenant(input.tenantId),
            requestId: rowId,
          });
        }
      }
      status = result.success ? NotificationStatus.SENT : NotificationStatus.FAILED;
      error = result.error ?? null;
      providerMessageId = result.providerMessageId ?? null;
    } catch (err) {
      status = NotificationStatus.FAILED;
      error = String(err);
    }

    // In production, an SMS routed to the mock provider means NO real Twilio is
    // connected for this salon — record it as FAILED with a clear reason instead
    // of a misleading "SENT", so the salon sees the customer text never went out.
    if (input.channel === NotificationChannel.SMS && providerName === 'mock' && process.env.NODE_ENV === 'production') {
      status = NotificationStatus.FAILED;
      error = 'SMS not sent — no Twilio number is connected for this salon. Connect Twilio in Settings -> SMS gateway (and make sure the plan includes SMS).';
    }

    return this.prisma.notification.create({
      data: {
        id: rowId,
        tenantId: input.tenantId,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject ?? null,
        body: input.body,
        status,
        provider: providerName,
        error,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        sentAt: status === NotificationStatus.SENT ? new Date() : null,
        // The provider's own message id (eSMS SMSID) — the delivery callback
        // finds this row by it. Spread-typed because the local Prisma client
        // may be stale; the column exists in the migration either way.
        ...({ providerMessageId } as Record<string, unknown>),
      },
    });
  }

  /**
   * Settle a notification row from an eSMS delivery callback.
   *
   * eSMS retries a failed callback 5 times and then never again, so this
   * method NEVER throws: an unmatched or half-formed callback is acknowledged
   * and dropped, because a 500 here buys nothing but five identical retries.
   * The row is found by SMSID first (what eSMS knows), then by our own id
   * (the RequestId we passed at send time) — and only rows that actually went
   * out through eSMS can be touched, so a forged callback cannot rewrite a
   * Twilio salon's history.
   */
  async applyEsmsCallback(query: Record<string, unknown>) {
    try {
      const r = readEsmsCallback(query ?? {});
      if (r.outcome === 'pending' || (!r.smsId && !r.requestId)) return { ok: true };

      const ors: Record<string, unknown>[] = [];
      if (r.smsId) ors.push({ providerMessageId: r.smsId });
      if (r.requestId) ors.push({ id: r.requestId });
      const row = (await this.prisma.notification.findFirst({
        where: { provider: { in: ['esms', 'zalo-zns'] }, OR: ors } as never,
        select: { id: true, status: true, deliveredAt: true } as never,
      })) as { id: string; status: NotificationStatus; deliveredAt: Date | null } | null;
      if (!row) return { ok: true };

      if (r.outcome === 'delivered') {
        await this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: NotificationStatus.SENT,
            error: null,
            ...({ deliveredAt: row.deliveredAt ?? new Date() } as Record<string, unknown>),
          },
        });
      } else if (!row.deliveredAt) {
        // A failure callback can race a delivery one; a row already marked
        // delivered stays delivered.
        await this.prisma.notification.update({
          where: { id: row.id },
          data: { status: NotificationStatus.FAILED, error: r.reason ?? 'Callback eSMS báo gửi thất bại' },
        });
      }
    } catch {
      // Swallowed by design — see the note above.
    }
    return { ok: true };
  }

  /**
   * The customer said stop — make it stick.
   *
   * Called when an inbound message matches the market's opt-out words
   * (sms-policy isOptOut: TU CHOI, HUY, STOP...), from whichever channel the
   * words arrived on. Clears smsConsent on every customer record carrying that
   * number in the tenant, so the marketing gate holds all future adverts.
   * Transactional messages (booking receipts, reminders) are untouched —
   * refusing adverts is not refusing your own appointment confirmation.
   */
  /**
   * A text that came in on one of our Twilio numbers. Only opt-out words do
   * anything; everything else is ignored. The salon is the one whose hotline
   * number was texted; on the shared Australian number (TWILIO_FROM_NUMBER_AU)
   * it is every Australian salon that has this customer.
   */
  async handleInboundSms(body: Record<string, string>): Promise<{ optedOut: number }> {
    const from = String(body.From ?? '').trim();
    const to = String(body.To ?? '').trim();
    const text = String(body.Body ?? '');
    if (!from || !to || !text.trim()) return { optedOut: 0 };
    const loose = this.prisma as unknown as {
      voiceLine?: { findFirst: (a: unknown) => Promise<{ tenantId: string } | null> };
    };
    let tenants: { id: string; market: string | null }[] = [];
    // The shared number is checked FIRST: it may also be one salon's hotline
    // (a demo line, say), and a STOP sent to it is about every Australian
    // salon that texts from it — not just the one whose hotline it is.
    if (to === String(process.env.TWILIO_FROM_NUMBER_AU ?? '').trim()) {
      const rows = await this.prisma.customer.findMany({
        where: { phone: from, tenant: { market: 'AU' } as never },
        select: { tenantId: true },
        take: 50,
      }).catch(() => [] as { tenantId: string }[]);
      tenants = [...new Set(rows.map((r) => r.tenantId))].map((id) => ({ id, market: 'AU' }));
    } else {
      const line = await loose.voiceLine?.findFirst({ where: { lumioNumber: to }, select: { tenantId: true } }).catch(() => null);
      if (line?.tenantId) {
        const t = await this.prisma.tenant.findUnique({ where: { id: line.tenantId }, select: { id: true, market: true } as never }).catch(() => null) as { id: string; market?: string | null } | null;
        if (t) tenants = [{ id: t.id, market: t.market ?? null }];
      }
    }
    let optedOut = 0;
    for (const t of tenants) {
      if (!isOptOut(smsPolicyFor(t.market), text)) continue;
      optedOut += await this.recordSmsOptOut(t.id, from).catch(() => 0);
    }
    return { optedOut };
  }

  async recordSmsOptOut(tenantId: string, phone: string): Promise<number> {
    const p = String(phone ?? '').trim();
    if (!p) return 0;
    try {
      const r = await this.prisma.customer.updateMany({
        where: { tenantId, phone: p },
        data: { smsConsent: false },
      });
      return r.count;
    } catch {
      return 0;
    }
  }

  /** List a tenant's notification history (Salon Admin). */
  list(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    const where: Prisma.NotificationWhereInput = tenantId ? { tenantId } : {};
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
