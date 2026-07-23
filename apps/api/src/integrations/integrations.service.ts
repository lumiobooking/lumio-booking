import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/**
 * One place that answers: "what is this salon connected to, and is it working?"
 *
 * It aggregates every third-party connection in the platform — payment
 * providers, marketing channels, email, SMS, Messenger, Google reviews and the
 * WordPress plugin — into a single normalized list, so the salon (and the
 * agency) can see at a glance what is connected, what is not, and what errors
 * out, without opening six different settings pages. No secrets ever leave
 * this service: only presence flags, hints and timestamps.
 */

export interface IntegrationItem {
  key: string;
  group: 'payments' | 'marketing' | 'messaging' | 'website';
  name: string;
  connected: boolean;
  /** ok = connected & healthy · warn = connected but needs attention · error = broken · off = not connected */
  state: 'ok' | 'warn' | 'error' | 'off';
  detail: string | null;
  lastActivity: Date | null;
  /** POST here (api) to live-test the connection; null = passive status only. */
  testPath: string | null;
  /** Frontend page where this connection is managed. */
  manageHref: string;
}

const PAY_LABEL: Record<string, string> = {
  dejavoo: 'Dejavoo / iPOSpays (máy cà thẻ)', square: 'Square (máy cà thẻ + online)',
  helcim: 'Helcim (máy cà thẻ + online)', sumup: 'SumUp (máy cà thẻ)',
  adyen: 'Adyen (máy cà thẻ)', stripe: 'Stripe (máy cà thẻ)', mock: 'Mock (test)',
};
const MKT_LABEL: Record<string, string> = {
  meta: 'Facebook / Instagram Ads', gbp: 'Google Maps (Business Profile)',
  tiktok: 'TikTok Ads', google_ads: 'Google Ads',
};

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser, requested?: string): string {
    const id = resolveTenantScope(user, requested);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  async list(user: AuthenticatedUser, tenantParam?: string): Promise<{ items: IntegrationItem[] }> {
    const tenantId = this.tenantId(user, tenantParam);
    const [payConns, devices, mktConns, msgr, gbrRow, wpSites, wpKeys, notif] = await Promise.all([
      this.prisma.paymentConnection.findMany({ where: { tenantId }, select: { provider: true, status: true, keyHint: true, lastCheckedAt: true, updatedAt: true } }),
      this.prisma.paymentDevice.findMany({ where: { tenantId }, select: { provider: true, status: true } }),
      this.prisma.marketingChannelConnection.findMany({ where: { tenantId } }) as Promise<any[]>,
      this.prisma.messengerConnection.findUnique({ where: { tenantId } }).catch(() => null),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'googleReviews' } } }).catch(() => null),
      this.prisma.wordpressSite.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.apiKey.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { wordpressSiteId: true, lastUsedAt: true } }),
      this.settings.getNotificationSettings(tenantId),
    ]);

    const items: IntegrationItem[] = [];

    // ---- Payments (per connected provider) ----
    for (const c of payConns) {
      if (c.provider === 'mock') continue;
      const devs = devices.filter((d) => d.provider === c.provider);
      const online = devs.filter((d) => d.status === 'ONLINE').length;
      const active = c.status === 'ACTIVE';
      items.push({
        key: `payment:${c.provider}`, group: 'payments',
        name: PAY_LABEL[c.provider] ?? c.provider,
        connected: active,
        state: !active ? 'error' : devs.length > 0 && online === 0 ? 'warn' : 'ok',
        detail: [
          c.keyHint ? `key …${c.keyHint}` : null,
          devs.length ? `${devs.length} máy (${online} online)` : 'chưa ghép máy',
          !active ? `trạng thái: ${c.status}` : null,
        ].filter(Boolean).join(' · '),
        lastActivity: c.lastCheckedAt ?? c.updatedAt,
        testPath: `/payments-hub/test/${c.provider}`,
        manageHref: '/salon/payment-terminals',
      });
    }
    if (payConns.filter((c) => c.provider !== 'mock').length === 0) {
      items.push({ key: 'payment:none', group: 'payments', name: 'Máy cà thẻ / thanh toán online', connected: false, state: 'off', detail: 'Chưa kết nối nhà thanh toán nào', lastActivity: null, testPath: null, manageHref: '/salon/payment-terminals' });
    }

    // ---- Marketing channels ----
    for (const m of mktConns) {
      const active = m.status === 'ACTIVE';
      items.push({
        key: `marketing:${m.platform}`, group: 'marketing',
        name: MKT_LABEL[m.platform] ?? m.platform,
        connected: active,
        state: m.lastError ? 'error' : active ? 'ok' : 'warn',
        detail: [m.accountName || m.externalAccountId || null, m.lastError ? `lỗi: ${String(m.lastError).slice(0, 80)}` : null, m.lastSyncedAt ? null : 'chưa đồng bộ lần nào'].filter(Boolean).join(' · ') || null,
        lastActivity: m.lastSyncedAt ?? m.updatedAt ?? null,
        testPath: `/marketing/channels/test/${m.platform}`,
        manageHref: '/salon/marketing/monthly',
      });
    }
    if (mktConns.length === 0) {
      items.push({ key: 'marketing:none', group: 'marketing', name: 'Kênh quảng cáo (Facebook/Google...)', connected: false, state: 'off', detail: 'Chưa kết nối kênh nào — có thể nhập chi phí tay, không bắt buộc', lastActivity: null, testPath: null, manageHref: '/salon/marketing/monthly' });
    }

    // ---- Google reviews (Business Profile OAuth) ----
    const gbr = (gbrRow?.value ?? {}) as { connected?: boolean; enabled?: boolean; locationTitle?: string };
    items.push({
      key: 'google-reviews', group: 'marketing', name: 'Google Reviews (trả lời đánh giá)',
      connected: !!gbr.connected,
      state: gbr.connected ? (gbr.enabled === false ? 'warn' : 'ok') : 'off',
      detail: gbr.connected ? [gbr.locationTitle || null, gbr.enabled === false ? 'đã kết nối nhưng đang TẮT' : null].filter(Boolean).join(' · ') || null : 'Chưa kết nối tài khoản Google',
      lastActivity: null, testPath: null, manageHref: '/salon/reviews-replies',
    });

    // ---- Email ----
    const emailOn = { Brevo: notif.brevo.apiKey.length > 0, Gmail: notif.gmail.refreshToken.length > 0, SMTP: notif.smtp.pass.length > 0 };
    const emailConnected = Object.values(emailOn).some(Boolean);
    items.push({
      key: 'email', group: 'messaging', name: 'Email (xác nhận & nhắc hẹn)',
      connected: emailConnected,
      state: emailConnected ? 'ok' : 'off',
      detail: emailConnected ? Object.entries(emailOn).filter(([, v]) => v).map(([k]) => `${k} ✓`).join(' · ') : 'Chưa cấu hình gửi email',
      lastActivity: null, testPath: '/settings/notifications/test', manageHref: '/salon/settings',
    });

    // ---- SMS (Twilio) ----
    const smsConnected = notif.twilio.accountSid.length > 0 && notif.twilio.authToken.length > 0;
    items.push({
      key: 'sms', group: 'messaging', name: 'SMS (Twilio — nhắc hẹn, hotline AI)',
      connected: smsConnected,
      state: smsConnected ? 'ok' : 'off',
      detail: smsConnected ? `SID ${String(notif.twilio.accountSid).slice(0, 8)}…` : 'Chưa cấu hình Twilio',
      lastActivity: null, testPath: '/settings/notifications/test-sms', manageHref: '/salon/settings',
    });

    // ---- Messenger bot ----
    items.push({
      key: 'messenger', group: 'messaging', name: 'Messenger bot (Facebook + Instagram DM)',
      connected: !!msgr,
      state: msgr ? (msgr.enabled ? 'ok' : 'warn') : 'off',
      detail: msgr ? [`Page ${msgr.pageId}`, msgr.igId ? 'IG ✓' : null, msgr.enabled ? null : 'đã kết nối nhưng bot đang TẮT'].filter(Boolean).join(' · ') : 'Chưa kết nối Fanpage',
      lastActivity: msgr?.updatedAt ?? null, testPath: null, manageHref: '/salon/messenger',
    });

    // ---- WordPress plugin sites ----
    const now = Date.now();
    for (const site of wpSites) {
      const keys = wpKeys.filter((k) => k.wordpressSiteId === site.id);
      const lastUsed = keys.reduce<Date | null>((a, k) => (k.lastUsedAt && (!a || k.lastUsedAt > a) ? k.lastUsedAt : a), null);
      const fresh = lastUsed && now - lastUsed.getTime() < 7 * 86_400_000;
      items.push({
        key: `wordpress:${site.id}`, group: 'website', name: `WordPress: ${site.name || site.siteUrl}`,
        connected: site.isActive && keys.length > 0,
        state: !site.isActive || keys.length === 0 ? 'off' : fresh ? 'ok' : 'warn',
        detail: keys.length === 0 ? 'Chưa cấp API key cho site này'
          : fresh ? 'Plugin đang hoạt động (có truy cập trong 7 ngày)'
          : lastUsed ? 'Không thấy plugin gọi về gần đây — kiểm tra website' : 'Plugin chưa gọi về lần nào — kiểm tra key trong WordPress',
        lastActivity: lastUsed, testPath: null, manageHref: '/salon/api-keys',
      });
    }
    if (wpSites.length === 0) {
      items.push({ key: 'wordpress:none', group: 'website', name: 'WordPress plugin (form đặt lịch trên web tiệm)', connected: false, state: 'off', detail: 'Chưa liên kết website WordPress nào', lastActivity: null, testPath: null, manageHref: '/salon/api-keys' });
    }

    return { items };
  }
}
