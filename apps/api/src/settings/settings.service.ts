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
    return { ...merged, businessHours: normalizeHours(merged.businessHours), daysOff: merged.daysOff ?? [] };
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
        clientId: typeof incGmail.clientId === 'string' ? incGmail.clientId : cur.gmail.clientId,
        // Blank client secret keeps the stored one.
        clientSecret: incGmail.clientSecret ? String(incGmail.clientSecret) : cur.gmail.clientSecret,
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
      const tokenData = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string };
      if (!tokenRes.ok || !tokenData.refresh_token) {
        return back('gmail=error&msg=no_refresh_token');
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
      gmailRedirectUri: this.gmailRedirectUri(),
    };
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
