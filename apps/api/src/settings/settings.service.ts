import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import {
  BOOKING_RULES_KEY,
  BookingRules,
  Branding,
  COMPANY_EXTRA_KEY,
  CompanyExtra,
  DayHours,
  DEFAULT_BOOKING_RULES,
  DEFAULT_BRANDING,
  DEFAULT_COMPANY_EXTRA,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_TEMPLATES,
  DEFAULT_PAYMENT_GATEWAYS,
  GATEWAY_IDS,
  GatewayConfig,
  GatewayId,
  NOTIFICATION_SETTINGS_KEY,
  NOTIFICATION_TEMPLATES_KEY,
  NotificationSettings,
  NotificationTemplates,
  PAYMENT_GATEWAYS_KEY,
  PaymentGateways,
  POS_SETTINGS_KEY,
  PosSettings,
  DEFAULT_POS_SETTINGS,
  LOYALTY_SETTINGS_KEY,
  LoyaltySettings,
  DEFAULT_LOYALTY_SETTINGS,
  REVIEW_SETTINGS_KEY,
  ReviewSettings,
  DEFAULT_REVIEW_SETTINGS,
  WEEKDAY_DISCOUNTS_KEY,
  WeekdayDiscounts,
  WeekdayDiscountRule,
  DEFAULT_WEEKDAY_DISCOUNTS,
  REMINDER_SETTINGS_KEY,
  ReminderSettings,
  DEFAULT_REMINDER_SETTINGS,
  DEPOSIT_SETTINGS_KEY,
  DepositSettings,
  DEFAULT_DEPOSIT_SETTINGS,
} from './settings.constants';
import { SmtpEmailProvider } from '../notifications/providers/smtp.provider';
import { BrevoEmailProvider } from '../notifications/providers/brevo.provider';
import { GmailOAuthProvider } from '../notifications/providers/gmail-oauth.provider';
import {
  UpdateBookingRulesDto,
  UpdateBrandingDto,
  UpdateCompanyDto,
  UpdateNotificationsDto,
  UpdatePaymentsDto,
} from './dto/update-settings.dto';

/**
 * Returns a usable secret (trimmed) from incoming input, or null when the field
 * is blank or just the masked UI placeholder (•••• / **** / dots). Used so that
 * re-saving settings never overwrites a stored secret with the mask, and so
 * pasted whitespace can't corrupt it (a common cause of Google "invalid_client").
 */
function cleanSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^[•*•.\s]+$/.test(t)) return null; // only mask characters
  return t;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async readKey<T>(tenantId: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key } } });
    return { ...fallback, ...((row?.value as Partial<T>) ?? {}) };
  }

  private async writeKey(tenantId: string, key: string, value: unknown) {
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { tenantId, key, value: value as unknown as Prisma.InputJsonValue },
    });
  }

  /** POS settings (tax rate on retail + receipt footer), merged over defaults. */
  async getPosSettings(tenantId: string): Promise<PosSettings> {
    return this.readKey<PosSettings>(tenantId, POS_SETTINGS_KEY, DEFAULT_POS_SETTINGS);
  }

  /** Loyalty program settings, merged over defaults. */
  async getLoyaltySettings(tenantId: string): Promise<LoyaltySettings> {
    return this.readKey<LoyaltySettings>(tenantId, LOYALTY_SETTINGS_KEY, DEFAULT_LOYALTY_SETTINGS);
  }

  async updateLoyalty(
    user: AuthenticatedUser,
    dto: { enabled?: boolean; earnPointsPerDollar?: number; redeemCentsPerPoint?: number; minRedeemPoints?: number },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.getLoyaltySettings(tenantId);
    const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? v : d);
    const next: LoyaltySettings = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      earnPointsPerDollar: num(dto.earnPointsPerDollar, cur.earnPointsPerDollar),
      redeemCentsPerPoint: num(dto.redeemCentsPerPoint, cur.redeemCentsPerPoint),
      minRedeemPoints: num(dto.minRedeemPoints, cur.minRedeemPoints),
    };
    await this.writeKey(tenantId, LOYALTY_SETTINGS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.loyalty_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  /** Review-reward program settings, merged over defaults. */
  async getReviewSettings(tenantId: string): Promise<ReviewSettings> {
    return this.readKey<ReviewSettings>(tenantId, REVIEW_SETTINGS_KEY, DEFAULT_REVIEW_SETTINGS);
  }

  async updateReview(
    user: AuthenticatedUser,
    dto: { enabled?: boolean; reviewMode?: string; googlePlaceId?: string; googleReviewUrl?: string; staffPointsPerFeedback?: number; staffBonusFor5Star?: number; customerPoints?: number; minRatingForGoogle?: number; requireRealVisit?: boolean; visitWindowHours?: number; dailyCapPerStaff?: number; dedupDays?: number; staffPointsPerSend?: number; sendDailyCap?: number; sendDedupHours?: number; anchorToVisits?: boolean; visitBuffer?: number; onlyBusinessHours?: boolean },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.getReviewSettings(tenantId);
    const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? v : d);
    const next: ReviewSettings = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      reviewMode: dto.reviewMode === 'rate_first' || dto.reviewMode === 'direct' ? dto.reviewMode : (cur.reviewMode ?? 'direct'),
      googlePlaceId: typeof dto.googlePlaceId === 'string' ? dto.googlePlaceId.trim() : (cur.googlePlaceId ?? ''),
      googleReviewUrl: typeof dto.googleReviewUrl === 'string' ? dto.googleReviewUrl.trim() : cur.googleReviewUrl,
      staffPointsPerFeedback: num(dto.staffPointsPerFeedback, cur.staffPointsPerFeedback),
      staffBonusFor5Star: num(dto.staffBonusFor5Star, cur.staffBonusFor5Star),
      customerPoints: num(dto.customerPoints, cur.customerPoints),
      minRatingForGoogle: Math.min(5, Math.max(1, num(dto.minRatingForGoogle, cur.minRatingForGoogle))),
      requireRealVisit: typeof dto.requireRealVisit === 'boolean' ? dto.requireRealVisit : (cur.requireRealVisit ?? true),
      visitWindowHours: num(dto.visitWindowHours, cur.visitWindowHours ?? 48),
      dailyCapPerStaff: num(dto.dailyCapPerStaff, cur.dailyCapPerStaff ?? 10),
      dedupDays: num(dto.dedupDays, cur.dedupDays ?? 7),
      staffPointsPerSend: num(dto.staffPointsPerSend, cur.staffPointsPerSend ?? 5),
      sendDailyCap: num(dto.sendDailyCap, cur.sendDailyCap ?? 20),
      sendDedupHours: num(dto.sendDedupHours, cur.sendDedupHours ?? 12),
      anchorToVisits: typeof dto.anchorToVisits === 'boolean' ? dto.anchorToVisits : (cur.anchorToVisits ?? true),
      visitBuffer: num(dto.visitBuffer, cur.visitBuffer ?? 3),
      onlyBusinessHours: typeof dto.onlyBusinessHours === 'boolean' ? dto.onlyBusinessHours : (cur.onlyBusinessHours ?? true),
    };
    await this.writeKey(tenantId, REVIEW_SETTINGS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.review_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async updatePos(
    user: AuthenticatedUser,
    dto: {
      taxRatePercent?: number;
      receiptFooter?: string;
      primaryCardGateway?: string;
      transferInstructions?: string;
      transferQrUrl?: string;
    },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.getPosSettings(tenantId);
    const next: PosSettings = {
      taxRatePercent:
        typeof dto.taxRatePercent === 'number' && dto.taxRatePercent >= 0 ? dto.taxRatePercent : cur.taxRatePercent,
      receiptFooter: typeof dto.receiptFooter === 'string' ? dto.receiptFooter : cur.receiptFooter,
      primaryCardGateway:
        typeof dto.primaryCardGateway === 'string' ? dto.primaryCardGateway : cur.primaryCardGateway,
      transferInstructions:
        typeof dto.transferInstructions === 'string' ? dto.transferInstructions : cur.transferInstructions,
      transferQrUrl: typeof dto.transferQrUrl === 'string' ? dto.transferQrUrl : cur.transferQrUrl,
    };
    await this.writeKey(tenantId, POS_SETTINGS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.pos_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  /** Booking rules merged over defaults, with a guaranteed 7-day hours array. */
  async getBookingRules(tenantId: string): Promise<BookingRules> {
    const merged = await this.readKey<BookingRules>(tenantId, BOOKING_RULES_KEY, DEFAULT_BOOKING_RULES);
    // Online payment is only truly available when a gateway is enabled AND has a
    // secret saved. Derive it live so a stale stored flag can never offer "Pay
    // online" to customers when no gateway is actually connected.
    const gateways = await this.getGateways(tenantId);
    const onlinePaymentEnabled = (Object.values(gateways) as GatewayConfig[]).some(
      (g) => g.enabled && g.secret.length > 0,
    );
    return { ...merged, onlinePaymentEnabled, businessHours: normalizeHours(merged.businessHours), daysOff: merged.daysOff ?? [] };
  }

  brandingFrom(branding: unknown): Branding {
    return { ...DEFAULT_BRANDING, ...((branding as Partial<Branding>) ?? {}) };
  }

  /** Raw gateway config (incl. secrets) — for server-side use only. */
  async getGateways(tenantId: string): Promise<PaymentGateways> {
    const stored = await this.readKey<PaymentGateways>(tenantId, PAYMENT_GATEWAYS_KEY, DEFAULT_PAYMENT_GATEWAYS);
    const out = {} as PaymentGateways;
    for (const id of GATEWAY_IDS) {
      out[id] = { ...DEFAULT_PAYMENT_GATEWAYS[id], ...(stored[id] ?? {}) };
    }
    return out;
  }

  /** Full notification settings (incl. secrets) — server-side use. */
  async getNotificationSettings(tenantId: string): Promise<NotificationSettings> {
    const merged = await this.readKey<NotificationSettings>(tenantId, NOTIFICATION_SETTINGS_KEY, DEFAULT_NOTIFICATION_SETTINGS);
    return {
      ...merged,
      smtp: { ...DEFAULT_NOTIFICATION_SETTINGS.smtp, ...(merged.smtp ?? {}) },
      brevo: { ...DEFAULT_NOTIFICATION_SETTINGS.brevo, ...(merged.brevo ?? {}) },
      gmail: { ...DEFAULT_NOTIFICATION_SETTINGS.gmail, ...(merged.gmail ?? {}) },
      twilio: { ...DEFAULT_NOTIFICATION_SETTINGS.twilio, ...(merged.twilio ?? {}) },
    };
  }

  /** Notification view for the frontend — hides the SMTP pass + Twilio token. */
  private sanitizeNotifications(n: NotificationSettings) {
    return {
      mailService: n.mailService,
      replyTo: n.replyTo,
      senderName: n.senderName,
      senderEmail: n.senderEmail,
      adminEmail: n.adminEmail,
      adminPhone: n.adminPhone,
      emailCustomerOnBooking: n.emailCustomerOnBooking,
      emailAdminOnBooking: n.emailAdminOnBooking,
      smsCustomerOnBooking: n.smsCustomerOnBooking,
      smsAdminOnBooking: n.smsAdminOnBooking,
      emailSubjectCustomer: n.emailSubjectCustomer,
      emailIntroCustomer: n.emailIntroCustomer,
      emailSubjectAdmin: n.emailSubjectAdmin,
      emailIntroAdmin: n.emailIntroAdmin,
      emailFooter: n.emailFooter,
      smsCustomer: n.smsCustomer,
      smsAdmin: n.smsAdmin,
      smtp: {
        host: n.smtp.host,
        port: n.smtp.port,
        user: n.smtp.user,
        fromEmail: n.smtp.fromEmail,
        secure: n.smtp.secure,
        connected: n.smtp.pass.length > 0,
      },
      brevo: {
        senderEmail: n.brevo.senderEmail,
        senderName: n.brevo.senderName,
        connected: n.brevo.apiKey.length > 0,
      },
      gmail: {
        clientId: n.gmail.clientId,
        senderEmail: n.gmail.senderEmail,
        // "connected" only when OAuth has produced a refresh token.
        connected: n.gmail.refreshToken.length > 0,
      },
      twilio: {
        accountSid: n.twilio.accountSid,
        fromNumber: n.twilio.fromNumber,
        connected: n.twilio.authToken.length > 0,
      },
    };
  }

  async updateNotifications(user: AuthenticatedUser, dto: UpdateNotificationsDto) {
    const tenantId = this.tenantId(user);
    const cur = await this.getNotificationSettings(tenantId);
    const incSmtp = (dto.smtp ?? {}) as Record<string, unknown>;
    const incBrevo = (dto.brevo ?? {}) as Record<string, unknown>;
    const incGmail = (dto.gmail ?? {}) as Record<string, unknown>;
    const incTwilio = (dto.twilio ?? {}) as Record<string, unknown>;
    const merged: NotificationSettings = {
      ...cur,
      ...stripUndefined(dto as Record<string, unknown>),
      smtp: {
        host: typeof incSmtp.host === 'string' && incSmtp.host ? incSmtp.host : cur.smtp.host,
        port: typeof incSmtp.port === 'number' ? incSmtp.port : cur.smtp.port,
        user: typeof incSmtp.user === 'string' ? incSmtp.user : cur.smtp.user,
        fromEmail: typeof incSmtp.fromEmail === 'string' ? incSmtp.fromEmail : cur.smtp.fromEmail,
        secure: incSmtp.secure === 'ssl' || incSmtp.secure === 'tls' || incSmtp.secure === 'none' ? incSmtp.secure : cur.smtp.secure,
        // Blank password keeps the stored one.
        pass: incSmtp.pass ? String(incSmtp.pass) : cur.smtp.pass,
      },
      brevo: {
        senderEmail: typeof incBrevo.senderEmail === 'string' ? incBrevo.senderEmail : cur.brevo.senderEmail,
        senderName: typeof incBrevo.senderName === 'string' ? incBrevo.senderName : cur.brevo.senderName,
        // Blank API key keeps the stored one.
        apiKey: incBrevo.apiKey ? String(incBrevo.apiKey) : cur.brevo.apiKey,
      },
      gmail: {
        // Trim to defeat copy-paste whitespace/newlines (a common cause of
        // Google's "invalid_client").
        clientId: typeof incGmail.clientId === 'string' && incGmail.clientId.trim() ? incGmail.clientId.trim() : cur.gmail.clientId,
        // A blank OR masked secret (the UI placeholder ••••) keeps the stored
        // one — so re-saving settings can never overwrite the real secret with
        // dots. Real values are trimmed.
        clientSecret: cleanSecret(incGmail.clientSecret) ?? cur.gmail.clientSecret,
        // refreshToken + senderEmail are set only by the OAuth callback.
        refreshToken: cur.gmail.refreshToken,
        senderEmail: cur.gmail.senderEmail,
      },
      twilio: {
        accountSid: typeof incTwilio.accountSid === 'string' ? incTwilio.accountSid : cur.twilio.accountSid,
        fromNumber: typeof incTwilio.fromNumber === 'string' ? incTwilio.fromNumber : cur.twilio.fromNumber,
        authToken: incTwilio.authToken ? String(incTwilio.authToken) : cur.twilio.authToken,
      },
    } as NotificationSettings;
    await this.writeKey(tenantId, NOTIFICATION_SETTINGS_KEY, merged);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.notifications_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  /** Per-event notification templates, merged over the default catalog. */
  async getNotificationTemplates(tenantId: string): Promise<NotificationTemplates> {
    const stored = await this.readKey<NotificationTemplates>(tenantId, NOTIFICATION_TEMPLATES_KEY, {});
    // Merge each default event with any stored override so newly-added events
    // always appear, and an event's defaults fill missing fields.
    const out: NotificationTemplates = {};
    for (const [id, def] of Object.entries(DEFAULT_NOTIFICATION_TEMPLATES)) {
      out[id] = { ...def, ...(stored[id] ?? {}) };
    }
    return out;
  }

  async updateNotificationTemplates(user: AuthenticatedUser, dto: { templates?: NotificationTemplates }) {
    const tenantId = this.tenantId(user);
    const cur = await this.getNotificationTemplates(tenantId);
    const incoming = dto.templates ?? {};
    const merged: NotificationTemplates = { ...cur };
    // Only persist known event ids; ignore anything unexpected.
    for (const id of Object.keys(DEFAULT_NOTIFICATION_TEMPLATES)) {
      if (incoming[id]) merged[id] = { ...cur[id], ...incoming[id] };
    }
    await this.writeKey(tenantId, NOTIFICATION_TEMPLATES_KEY, merged);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.notification_templates_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  // ---- Gmail OAuth2 connect (Google API — like WP Mail SMTP's Google mailer) ----

  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || process.env.KEEPALIVE_WEB_URL || cors || 'https://lumio-web-1xqk.onrender.com').replace(/\/$/, '');
  }
  /** Redirect URI the salon must add to their Google OAuth client. */
  gmailRedirectUri(): string {
    return `${this.apiBase()}/api/settings/gmail/callback`;
  }
  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): string | null {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(payload).digest('base64url');
    if (sig !== expect) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!data.exp || Date.now() > data.exp) return null;
      return data.t;
    } catch {
      return null;
    }
  }

  /** Build the Google consent URL the salon admin is sent to. */
  async gmailAuthUrl(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const n = await this.getNotificationSettings(tenantId);
    if (!n.gmail.clientId || !n.gmail.clientSecret) {
      throw new BadRequestException('Enter your Google Client ID and Client secret and Save before connecting.');
    }
    const params = new URLSearchParams({
      client_id: n.gmail.clientId,
      redirect_uri: this.gmailRedirectUri(),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state: this.signState(tenantId),
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /** Google redirects here with ?code&state. Exchange for a refresh token + email,
   *  store them, switch the salon to Gmail, then bounce back to the web settings. */
  async gmailCallback(code: string, state: string): Promise<string> {
    const web = this.webBase();
    const back = (q: string) => `${web}/salon/settings?${q}`;
    const tenantId = this.verifyState(state);
    if (!tenantId || !code) return back('gmail=error&msg=invalid_state');
    const n = await this.getNotificationSettings(tenantId);
    if (!n.gmail.clientId || !n.gmail.clientSecret) return back('gmail=error&msg=missing_client');
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: n.gmail.clientId,
          client_secret: n.gmail.clientSecret,
          redirect_uri: this.gmailRedirectUri(),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tokenData = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string };
      if (!tokenRes.ok || !tokenData.refresh_token) {
        // Surface Google's real reason (e.g. invalid_client = wrong secret) instead
        // of a generic message, so the salon knows exactly what to fix.
        const why = tokenData.error ? tokenData.error : 'no_refresh_token';
        return back(`gmail=error&msg=${encodeURIComponent(why)}`);
      }
      let senderEmail = n.gmail.senderEmail;
      if (tokenData.access_token) {
        const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { authorization: `Bearer ${tokenData.access_token}` },
        });
        const uiData = (await ui.json().catch(() => ({}))) as { email?: string };
        if (uiData.email) senderEmail = uiData.email;
      }
      await this.writeKey(tenantId, NOTIFICATION_SETTINGS_KEY, {
        ...n,
        mailService: 'gmail',
        senderEmail: n.senderEmail || senderEmail,
        gmail: { ...n.gmail, refreshToken: tokenData.refresh_token, senderEmail },
      });
      await this.audit.log({ tenantId, userId: null, action: 'settings.gmail_connected', resourceType: 'tenant', resourceId: tenantId });
      return back('gmail=connected');
    } catch {
      return back('gmail=error&msg=exchange_failed');
    }
  }

  /**
   * Sends a real test email using the saved SMTP credentials, to the admin email
   * (or the SMTP user). Returns the exact error message so the admin can fix it.
   */
  async sendTestEmail(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const n = await this.getNotificationSettings(tenantId);

    const reply = n.replyTo || undefined;
    const senderName = n.senderName || 'Lumio Booking';
    const brevoReady = !!(n.brevo.apiKey && n.senderEmail);
    const smtpReady = !!(n.smtp.user && n.smtp.pass);
    const gmailReady = !!(n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail);
    const envBrevoKey = process.env.BREVO_API_KEY;
    const envBrevoSender = process.env.BREVO_SENDER_EMAIL;
    const mkBrevo = (apiKey: string, senderEmail: string) =>
      new BrevoEmailProvider({ apiKey, senderEmail, senderName, replyTo: reply });
    const mkGmail = () =>
      new GmailOAuthProvider({
        clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken,
        senderEmail: n.gmail.senderEmail, senderName, replyTo: reply,
      });
    const mkSmtp = () =>
      new SmtpEmailProvider({
        host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: reply,
        from: `${senderName} <${n.senderEmail || n.smtp.user}>`,
      });

    // The salon's explicit Mail service choice wins; otherwise auto-detect.
    let provider: SmtpEmailProvider | BrevoEmailProvider | GmailOAuthProvider;
    let to: string;
    if (n.mailService === 'off') {
      return { ok: false, error: 'Email sending is set to Off. Choose SMTP or Brevo as the Mail service, then Save before testing.' };
    } else if (n.mailService === 'brevo') {
      if (!n.brevo.apiKey) return { ok: false, error: 'Brevo is selected but the API key is missing.' };
      if (!n.senderEmail) return { ok: false, error: 'Please set a Sender email (it must be verified in Brevo).' };
      provider = mkBrevo(n.brevo.apiKey, n.senderEmail);
      to = n.adminEmail || n.senderEmail;
    } else if (n.mailService === 'smtp') {
      if (!smtpReady) return { ok: false, error: 'SMTP is selected but missing the username or password.' };
      provider = mkSmtp();
      to = n.adminEmail || n.senderEmail || n.smtp.user;
    } else if (n.mailService === 'gmail') {
      if (!gmailReady) return { ok: false, error: 'Gmail is selected but not connected yet. Enter Client ID/secret, Save, then click “Connect with Google”.' };
      provider = mkGmail();
      to = n.adminEmail || n.senderEmail || n.gmail.senderEmail;
    } else if (gmailReady) {
      provider = mkGmail();
      to = n.adminEmail || n.senderEmail || n.gmail.senderEmail;
    } else if (brevoReady) {
      provider = mkBrevo(n.brevo.apiKey, n.senderEmail);
      to = n.adminEmail || n.senderEmail;
    } else if (smtpReady) {
      provider = mkSmtp();
      to = n.adminEmail || n.senderEmail || n.smtp.user;
    } else if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_SENDER_EMAIL) {
      // Platform Gmail (OAuth2) — same mechanism as WP Mail SMTP's Google mailer.
      provider = new GmailOAuthProvider({
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        senderEmail: process.env.GMAIL_SENDER_EMAIL,
        senderName,
        replyTo: reply,
      });
      to = n.adminEmail || n.senderEmail || process.env.GMAIL_SENDER_EMAIL;
    } else if (envBrevoKey && envBrevoSender) {
      provider = mkBrevo(envBrevoKey, envBrevoSender);
      to = n.adminEmail || envBrevoSender;
    } else {
      return { ok: false, error: 'No email provider configured. Pick a Mail service (SMTP or Brevo) and fill its fields, then Save before testing.' };
    }
    const sendPromise = provider.sendEmail({
      to,
      subject: 'Lumio Booking — test email',
      body: 'This is a test email from your Lumio Booking notification settings. If you received it, email sending works.',
      html: '<p>This is a <strong>test email</strong> from your Lumio Booking notification settings.</p><p>If you received it, your email sending is working correctly. ✅</p>',
    });
    // Hard ceiling so the request can never hang the UI, even if the network stalls.
    const timeout = new Promise<{ success: boolean; error?: string }>((resolve) =>
      setTimeout(
        () => resolve({ success: false, error: 'Timed out after 22s: the mail server did not respond. The host may be blocking outbound SMTP, or Gmail is refusing the connection from the cloud server.' }),
        22000,
      ),
    );
    const result = await Promise.race([sendPromise, timeout]);
    return result.success ? { ok: true, to } : { ok: false, error: result.error || 'Send failed' };
  }

  /** Gateway view for the frontend — NEVER includes the secret value. */
  private sanitizeGateways(raw: PaymentGateways) {
    const out: Record<string, { enabled: boolean; connected: boolean; apiKey: string }> = {};
    for (const id of GATEWAY_IDS) {
      const g = raw[id];
      out[id] = { enabled: g.enabled, connected: g.secret.length > 0, apiKey: g.apiKey };
    }
    return out;
  }

  /** Company extra fields (address, website), merged over defaults. Used by the public SEO payload. */
  async getCompanyExtra(tenantId: string): Promise<CompanyExtra> {
    return this.readKey<CompanyExtra>(tenantId, COMPANY_EXTRA_KEY, DEFAULT_COMPANY_EXTRA);
  }

  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, contactEmail: true, contactPhone: true, timezone: true, branding: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const extra = await this.readKey<CompanyExtra>(tenantId, COMPANY_EXTRA_KEY, DEFAULT_COMPANY_EXTRA);
    return {
      company: {
        name: tenant.name,
        slug: tenant.slug,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        timezone: tenant.timezone,
        address: extra.address,
        website: extra.website,
      },
      booking: await this.getBookingRules(tenantId),
      branding: this.brandingFrom(tenant.branding),
      gateways: this.sanitizeGateways(await this.getGateways(tenantId)),
      notifications: this.sanitizeNotifications(await this.getNotificationSettings(tenantId)),
      notificationTemplates: await this.getNotificationTemplates(tenantId),
      pos: await this.getPosSettings(tenantId),
      loyalty: await this.getLoyaltySettings(tenantId),
      review: await this.getReviewSettings(tenantId),
      weekdayDiscounts: await this.getWeekdayDiscounts(tenantId),
      reminders: await this.getReminderSettings(tenantId),
      deposit: await this.getDepositSettings(tenantId),
      gmailRedirectUri: this.gmailRedirectUri(),
    };
  }

  async getDepositSettings(tenantId: string): Promise<DepositSettings> {
    return this.readKey<DepositSettings>(tenantId, DEPOSIT_SETTINGS_KEY, DEFAULT_DEPOSIT_SETTINGS);
  }

  async updateDepositSettings(user: AuthenticatedUser, dto: Partial<DepositSettings>) {
    const tenantId = this.tenantId(user);
    const cur = await this.getDepositSettings(tenantId);
    const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? Math.round(v) : d);
    const next: DepositSettings = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      type: dto.type === 'fixed' || dto.type === 'percent' ? dto.type : (cur.type ?? 'percent'),
      percent: Math.min(100, Math.max(1, num(dto.percent, cur.percent ?? 30))),
      fixedCents: num(dto.fixedCents, cur.fixedCents ?? 1000),
      scope: dto.scope === 'new' || dto.scope === 'repeat_noshow' || dto.scope === 'all' ? dto.scope : (cur.scope ?? 'all'),
      noShowThreshold: Math.max(1, num(dto.noShowThreshold, cur.noShowThreshold ?? 2)),
    };
    await this.writeKey(tenantId, DEPOSIT_SETTINGS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.deposit_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async getReminderSettings(tenantId: string): Promise<ReminderSettings> {
    return this.readKey<ReminderSettings>(tenantId, REMINDER_SETTINGS_KEY, DEFAULT_REMINDER_SETTINGS);
  }

  async updateReminderSettings(user: AuthenticatedUser, dto: { enabled?: boolean; hoursBefore1?: number; hoursBefore2?: number; channelEmail?: boolean; channelSms?: boolean }) {
    const tenantId = this.tenantId(user);
    const cur = await this.getReminderSettings(tenantId);
    const clampH = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 168 ? Math.round(v) : d);
    const next: ReminderSettings = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      hoursBefore1: clampH(dto.hoursBefore1, cur.hoursBefore1 ?? 24),
      hoursBefore2: clampH(dto.hoursBefore2, cur.hoursBefore2 ?? 3),
      channelEmail: typeof dto.channelEmail === 'boolean' ? dto.channelEmail : (cur.channelEmail ?? true),
      channelSms: typeof dto.channelSms === 'boolean' ? dto.channelSms : (cur.channelSms ?? true),
    };
    await this.writeKey(tenantId, REMINDER_SETTINGS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.reminders_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async getWeekdayDiscounts(tenantId: string): Promise<WeekdayDiscounts> {
    return this.readKey<WeekdayDiscounts>(tenantId, WEEKDAY_DISCOUNTS_KEY, DEFAULT_WEEKDAY_DISCOUNTS);
  }

  async updateWeekdayDiscounts(user: AuthenticatedUser, dto: { enabled?: boolean; message?: string; rules?: WeekdayDiscountRule[] }) {
    const tenantId = this.tenantId(user);
    const cur = await this.getWeekdayDiscounts(tenantId);
    const rules = Array.isArray(dto.rules)
      ? dto.rules
          .filter((r) => typeof r?.day === 'number' && r.day >= 0 && r.day <= 6 && typeof r.percent === 'number' && r.percent > 0)
          .map((r) => ({ day: Math.round(r.day), categoryId: r.categoryId || null, percent: Math.min(90, Math.max(1, Math.round(r.percent))) }))
          .slice(0, 100)
      : cur.rules;
    const next: WeekdayDiscounts = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      message: typeof dto.message === 'string' ? dto.message.slice(0, 160) : cur.message,
      rules,
    };
    await this.writeKey(tenantId, WEEKDAY_DISCOUNTS_KEY, next);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.weekday_discounts_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  /**
   * Update payments: currency + on-site method (in booking rules) and the online
   * gateways. A blank secret keeps the existing one (so the admin doesn't have to
   * re-type it). onlinePaymentEnabled is derived = any gateway enabled & connected.
   */
  async updatePayments(user: AuthenticatedUser, dto: UpdatePaymentsDto) {
    const tenantId = this.tenantId(user);
    const current = await this.getGateways(tenantId);
    const incoming = (dto.gateways ?? {}) as Record<string, Partial<GatewayConfig>>;

    const merged = {} as PaymentGateways;
    for (const id of GATEWAY_IDS) {
      const cur = current[id];
      const inc = incoming[id] ?? {};
      merged[id] = {
        enabled: typeof inc.enabled === 'boolean' ? inc.enabled : cur.enabled,
        apiKey: typeof inc.apiKey === 'string' ? inc.apiKey : cur.apiKey,
        // Blank secret = keep the stored one.
        secret: inc.secret ? String(inc.secret) : cur.secret,
      };
    }
    await this.writeKey(tenantId, PAYMENT_GATEWAYS_KEY, merged);

    const onlineEnabled = (Object.values(merged) as GatewayConfig[]).some(
      (g) => g.enabled && g.secret.length > 0,
    );

    const rules = await this.getBookingRules(tenantId);
    await this.writeKey(tenantId, BOOKING_RULES_KEY, {
      ...rules,
      currency: dto.currency ?? rules.currency,
      currencySymbol: dto.currencySymbol ?? rules.currencySymbol,
      symbolPosition: dto.symbolPosition ?? rules.symbolPosition,
      priceDecimals: typeof dto.priceDecimals === 'number' ? dto.priceDecimals : rules.priceDecimals,
      defaultPaymentMethod: dto.defaultPaymentMethod ?? rules.defaultPaymentMethod,
      payLaterEnabled: typeof dto.onSiteEnabled === 'boolean' ? dto.onSiteEnabled : rules.payLaterEnabled,
      onlinePaymentEnabled: onlineEnabled,
    });

    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.payments_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async updateCompany(user: AuthenticatedUser, dto: UpdateCompanyDto) {
    const tenantId = this.tenantId(user);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: dto.name,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        timezone: dto.timezone,
      },
    });
    if (dto.address !== undefined || dto.website !== undefined) {
      const current = await this.readKey<CompanyExtra>(tenantId, COMPANY_EXTRA_KEY, DEFAULT_COMPANY_EXTRA);
      await this.writeKey(tenantId, COMPANY_EXTRA_KEY, {
        address: dto.address ?? current.address,
        website: dto.website ?? current.website,
      });
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.company_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async updateBooking(user: AuthenticatedUser, dto: UpdateBookingRulesDto) {
    const tenantId = this.tenantId(user);
    const current = await this.getBookingRules(tenantId);
    const merged: BookingRules = {
      ...current,
      ...stripUndefined(dto as Record<string, unknown>),
      businessHours: dto.businessHours ? normalizeHours(dto.businessHours) : current.businessHours,
      daysOff: dto.daysOff ?? current.daysOff,
    } as BookingRules;
    await this.writeKey(tenantId, BOOKING_RULES_KEY, merged);
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.booking_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }

  async updateBranding(user: AuthenticatedUser, dto: UpdateBrandingDto) {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { branding: true } });
    const merged: Branding = { ...this.brandingFrom(tenant?.branding), ...stripUndefined(dto as Record<string, unknown>) };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { branding: merged as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'settings.branding_updated', resourceType: 'tenant', resourceId: tenantId });
    return this.get(user);
  }
}

/** Ensures a valid 7-entry business-hours array. */
function normalizeHours(input: unknown): DayHours[] {
  const arr = Array.isArray(input) ? input : [];
  const out: DayHours[] = [];
  for (let i = 0; i < 7; i++) {
    const d = (arr[i] ?? {}) as Partial<DayHours>;
    out.push({
      closed: Boolean(d.closed),
      openMinutes: typeof d.openMinutes === 'number' ? d.openMinutes : 540,
      closeMinutes: typeof d.closeMinutes === 'number' ? d.closeMinutes : 1080,
    });
  }
  return out;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && k !== 'businessHours' && k !== 'daysOff') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
