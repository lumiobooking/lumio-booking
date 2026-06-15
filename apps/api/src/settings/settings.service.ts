import { Injectable, NotFoundException } from '@nestjs/common';
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
} from './settings.constants';
import { SmtpEmailProvider } from '../notifications/providers/smtp.provider';
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
      twilio: { ...DEFAULT_NOTIFICATION_SETTINGS.twilio, ...(merged.twilio ?? {}) },
    };
  }

  /** Notification view for the frontend — hides the SMTP pass + Twilio token. */
  private sanitizeNotifications(n: NotificationSettings) {
    return {
      senderName: n.senderName,
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
        connected: n.smtp.pass.length > 0,
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
    const incTwilio = (dto.twilio ?? {}) as Record<string, unknown>;
    const merged: NotificationSettings = {
      ...cur,
      ...stripUndefined(dto as Record<string, unknown>),
      smtp: {
        host: typeof incSmtp.host === 'string' && incSmtp.host ? incSmtp.host : cur.smtp.host,
        port: typeof incSmtp.port === 'number' ? incSmtp.port : cur.smtp.port,
        user: typeof incSmtp.user === 'string' ? incSmtp.user : cur.smtp.user,
        fromEmail: typeof incSmtp.fromEmail === 'string' ? incSmtp.fromEmail : cur.smtp.fromEmail,
        // Blank password keeps the stored one.
        pass: incSmtp.pass ? String(incSmtp.pass) : cur.smtp.pass,
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

  /**
   * Sends a real test email using the saved SMTP credentials, to the admin email
   * (or the SMTP user). Returns the exact error message so the admin can fix it.
   */
  async sendTestEmail(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const n = await this.getNotificationSettings(tenantId);
    if (!n.smtp.user || !n.smtp.pass) {
      return { ok: false, error: 'SMTP is not configured. Enter your Gmail address and App Password, then Save, before testing.' };
    }
    const to = n.adminEmail || n.smtp.user;
    const provider = new SmtpEmailProvider({
      host: n.smtp.host,
      port: n.smtp.port,
      user: n.smtp.user,
      pass: n.smtp.pass,
      from: `${n.senderName || 'Lumio Booking'} <${n.smtp.fromEmail || n.smtp.user}>`,
    });
    const result = await provider.sendEmail({
      to,
      subject: 'Lumio Booking — test email',
      body: 'This is a test email from your Lumio Booking notification settings. If you received it, email sending works.',
      html: '<p>This is a <strong>test email</strong> from your Lumio Booking notification settings.</p><p>If you received it, your email sending is working correctly. ✅</p>',
    });
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
