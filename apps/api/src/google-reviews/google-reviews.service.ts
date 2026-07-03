import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

// Status is a Prisma enum ('NEW' | 'DRAFTED' | ...). We use plain string literals
// (assignable to the enum) so this file doesn't hard-depend on the generated enum.
type GStatus = 'NEW' | 'DRAFTED' | 'REPLIED' | 'NEEDS_ATTENTION' | 'SKIPPED';

const GBR_KEY = 'googleReviews';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GbrSettings {
  enabled: boolean; // master switch for auto-processing
  connected: boolean; // OAuth granted
  refreshToken: string; // secret (never sent to the client)
  accountId: string; // "accounts/123"
  locationId: string; // "locations/456"
  connectedEmail: string;
  autoMinStars: number; // >= this → draft/auto reply (default 4)
  alertMaxStars: number; // <= this → alert manager, no auto reply (default 3)
  approveFirst: boolean; // true = draft & wait for one-tap approval (default)
  alertEmail: string; // where bad-review alerts go (falls back to salon email)
  tone: 'warm' | 'professional' | 'short';
  lastSyncAt: string | null;
}

const DEFAULTS: GbrSettings = {
  enabled: false, connected: false, refreshToken: '', accountId: '', locationId: '',
  connectedEmail: '', autoMinStars: 4, alertMaxStars: 3, approveFirst: true,
  alertEmail: '', tone: 'warm', lastSyncAt: null,
};

/** A blank or masked ("••••") secret must never overwrite the stored one. */
function cleanSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^[•*·.\s]+$/.test(t)) return null;
  return t;
}

@Injectable()
export class GoogleReviewsService {
  private readonly logger = new Logger('GoogleReviews');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- helpers -------------------------------------------------------------
  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  private redirectUri(): string {
    return `${this.apiBase()}/api/google-reviews/callback`;
  }
  private clientId(): string {
    return process.env.GBP_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  }
  private clientSecret(): string {
    return process.env.GBP_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  }
  private signingSecret(): string {
    return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-gbp-signing-dev';
  }
  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): string | null {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    if (sig !== expect) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!data.exp || Date.now() > data.exp) return null;
      return data.t;
    } catch {
      return null;
    }
  }

  // ---- settings ------------------------------------------------------------
  async getSettings(tenantId: string): Promise<GbrSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: GBR_KEY } } });
    const stored = (row?.value ?? {}) as Partial<GbrSettings>;
    return { ...DEFAULTS, ...stored };
  }
  private async writeSettings(tenantId: string, patch: Partial<GbrSettings>): Promise<GbrSettings> {
    const cur = await this.getSettings(tenantId);
    const next = { ...cur, ...patch };
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: GBR_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: GBR_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** Client-safe view of the settings (no secret) + inbox counts. */
  async get(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    const grouped = await this.prisma.googleReview.groupBy({ by: ['status'], where: { tenantId }, _count: true });
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status as string] = g._count;
    return {
      enabled: s.enabled,
      connected: s.connected,
      connectedEmail: s.connectedEmail,
      accountId: s.accountId,
      locationId: s.locationId,
      hasLocation: Boolean(s.accountId && s.locationId),
      autoMinStars: s.autoMinStars,
      alertMaxStars: s.alertMaxStars,
      approveFirst: s.approveFirst,
      alertEmail: s.alertEmail,
      tone: s.tone,
      lastSyncAt: s.lastSyncAt,
      clientConfigured: Boolean(this.clientId() && this.clientSecret()),
      redirectUri: this.redirectUri(),
      counts,
    };
  }

  async updateSettings(
    user: AuthenticatedUser,
    dto: {
      enabled?: boolean; autoMinStars?: number; alertMaxStars?: number;
      approveFirst?: boolean; alertEmail?: string; tone?: string;
      accountId?: string; locationId?: string; refreshToken?: string;
    },
  ) {
    const tenantId = this.tenantId(user);
    const cur = await this.getSettings(tenantId);
    const clampStar = (v: unknown, d: number) => (typeof v === 'number' ? Math.min(5, Math.max(1, Math.round(v))) : d);
    const patch: Partial<GbrSettings> = {
      enabled: typeof dto.enabled === 'boolean' ? dto.enabled : cur.enabled,
      autoMinStars: clampStar(dto.autoMinStars, cur.autoMinStars),
      alertMaxStars: clampStar(dto.alertMaxStars, cur.alertMaxStars),
      approveFirst: typeof dto.approveFirst === 'boolean' ? dto.approveFirst : cur.approveFirst,
      alertEmail: typeof dto.alertEmail === 'string' ? dto.alertEmail.trim() : cur.alertEmail,
      tone: dto.tone === 'professional' || dto.tone === 'short' || dto.tone === 'warm' ? dto.tone : cur.tone,
      accountId: typeof dto.accountId === 'string' ? dto.accountId.trim() : cur.accountId,
      locationId: typeof dto.locationId === 'string' ? dto.locationId.trim() : cur.locationId,
      // Secret only overwritten when a real (non-masked) value is provided.
      refreshToken: cleanSecret(dto.refreshToken) ?? cur.refreshToken,
    };
    await this.writeSettings(tenantId, patch);
    await this.audit(tenantId, user.userId, 'google_reviews.settings_updated');
    return this.get(user);
  }

  // ---- OAuth ---------------------------------------------------------------
  async authUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = this.tenantId(user);
    if (!this.clientId() || !this.clientSecret()) {
      throw new BadRequestException('The platform Google OAuth client is not configured yet. Contact Lumio support.');
    }
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: this.signState(tenantId),
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /** Google redirects here with ?code&state. Returns a URL to redirect the browser to. */
  async callback(code: string, state: string): Promise<string> {
    const web = this.webBase();
    const back = (q: string) => `${web}/salon/reviews-replies?${q}`;
    const tenantId = this.verifyState(state);
    if (!tenantId || !code) return back('gbp=error&msg=invalid_state');
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.clientId(),
          client_secret: this.clientSecret(),
          redirect_uri: this.redirectUri(),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string };
      if (!res.ok || !data.refresh_token) {
        return back(`gbp=error&msg=${encodeURIComponent(data.error || 'no_refresh_token')}`);
      }
      let email = '';
      if (data.access_token) {
        const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { authorization: `Bearer ${data.access_token}` },
        }).then((r) => r.json()).catch(() => ({}));
        email = (me as { email?: string }).email || '';
      }
      await this.writeSettings(tenantId, { connected: true, refreshToken: data.refresh_token, connectedEmail: email });
      await this.audit(tenantId, null, 'google_reviews.connected');
      // Best-effort: auto-detect the first account+location so the salon is ready.
      await this.detectLocation(tenantId).catch(() => undefined);
      return back('gbp=connected');
    } catch (err) {
      this.logger.error(`GBP callback failed: ${String(err)}`);
      return back('gbp=error&msg=exception');
    }
  }

  async disconnect(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    await this.writeSettings(tenantId, { connected: false, refreshToken: '', accountId: '', locationId: '', connectedEmail: '' });
    await this.audit(tenantId, user.userId, 'google_reviews.disconnected');
    return this.get(user);
  }

  /** Refresh an access token for the tenant's stored refresh token. */
  private async accessToken(s: GbrSettings): Promise<string> {
    if (!s.refreshToken) throw new BadRequestException('Google account is not connected.');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        refresh_token: s.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`Google auth failed (${res.status}). Reconnect the account. ${t.slice(0, 120)}`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new BadRequestException('Google returned no access token.');
    return data.access_token;
  }

  // ---- location discovery (best-effort) ------------------------------------
  /** List the connected account's locations so the salon can pick the right one. */
  async listLocations(user: AuthenticatedUser): Promise<{ accountId: string; locations: { name: string; title: string }[] }> {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    const token = await this.accessToken(s);
    // Surface the real Google error (e.g. 403 SERVICE_DISABLED / quota) instead of
    // silently returning an empty list, so setup problems are easy to diagnose.
    const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!accRes.ok) {
      const t = await accRes.text().catch(() => '');
      throw new BadRequestException(`Google accounts call failed (${accRes.status}). ${t.slice(0, 240)}`);
    }
    const accounts = (await accRes.json()) as { accounts?: { name?: string }[] };
    const accountId = accounts.accounts?.[0]?.name || s.accountId || '';
    if (!accountId) {
      throw new BadRequestException('This Google login manages no Business Profile. Sign in with the account that owns the salon on Google.');
    }
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title&pageSize=100`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!locRes.ok) {
      const t = await locRes.text().catch(() => '');
      throw new BadRequestException(`Google locations call failed (${locRes.status}). ${t.slice(0, 240)}`);
    }
    const data = (await locRes.json()) as { locations?: { name?: string; title?: string }[] };
    const locations = (data.locations || [])
      .map((l) => ({ name: l.name || '', title: l.title || l.name || '' }))
      .filter((l) => l.name);
    return { accountId, locations };
  }

  private async detectLocation(tenantId: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    const token = await this.accessToken(s);
    const accounts = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json()).catch(() => ({}));
    const accountId = (accounts as { accounts?: { name?: string }[] }).accounts?.[0]?.name || '';
    if (!accountId) return;
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title&pageSize=1`,
      { headers: { authorization: `Bearer ${token}` } },
    ).then((r) => r.json()).catch(() => ({}));
    const loc = (locRes as { locations?: { name?: string }[] }).locations?.[0]?.name || '';
    if (accountId && loc) await this.writeSettings(tenantId, { accountId, locationId: loc });
  }

  async setLocation(user: AuthenticatedUser, accountId: string, locationId: string) {
    const tenantId = this.tenantId(user);
    await this.writeSettings(tenantId, { accountId: accountId.trim(), locationId: locationId.trim() });
    await this.audit(tenantId, user.userId, 'google_reviews.location_set');
    return this.get(user);
  }

  // ---- sync + routing ------------------------------------------------------
  // The v4 reviews path: an account + location, then its /reviews collection.
  private reviewsParent(s: GbrSettings): string {
    // locationId may be stored as "locations/456" or "accounts/1/locations/456".
    const loc = s.locationId.includes('/locations/') ? s.locationId : `${s.accountId}/${s.locationId}`;
    return loc.startsWith('accounts/') ? loc : `${s.accountId}/${s.locationId}`;
  }

  async syncNow(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    return this.syncReviews(tenantId);
  }

  /** Pull the latest reviews for a tenant, store new ones, and route them. */
  async syncReviews(tenantId: string): Promise<{ fetched: number; drafted: number; alerted: number }> {
    const s = await this.getSettings(tenantId);
    if (!s.connected) throw new BadRequestException('Connect your Google Business Profile first.');
    if (!s.accountId || !s.locationId) throw new BadRequestException('Choose which Google location this salon is, then sync.');
    const token = await this.accessToken(s);
    const parent = this.reviewsParent(s);
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${parent}/reviews?pageSize=50&orderBy=updateTime%20desc`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`Google reviews fetch failed (${res.status}). ${t.slice(0, 160)}`);
    }
    const data = (await res.json()) as { reviews?: GoogleApiReview[] };
    const reviews = data.reviews || [];
    const salonName = await this.salonName(tenantId);
    let drafted = 0;
    let alerted = 0;
    for (const r of reviews) {
      const gid = (r.reviewId || (r.name || '').split('/').pop() || '').trim();
      if (!gid) continue;
      const stars = STAR_MAP[r.starRating || ''] || 0;
      if (!stars) continue;
      const existing = await this.prisma.googleReview.findUnique({
        where: { tenantId_googleReviewId: { tenantId, googleReviewId: gid } },
      });
      const already = Boolean(r.reviewReply?.comment);
      const base = {
        reviewerName: r.reviewer?.displayName || null,
        reviewerPhoto: r.reviewer?.profilePhotoUrl || null,
        starRating: stars,
        comment: r.comment || null,
        reviewCreatedAt: r.createTime ? new Date(r.createTime) : null,
      };
      if (!existing) {
        // Decide the initial status for a brand-new review.
        const decided = this.decide(stars, r.comment || '', s, salonName, already, r.reviewer?.displayName || '');
        const created = await this.prisma.googleReview.create({
          data: { tenantId, googleReviewId: gid, ...base, status: decided.status, draftReply: decided.draft, replyText: already ? r.reviewReply?.comment || null : null, repliedAt: already ? new Date() : null },
        });
        if (decided.status === 'DRAFTED') drafted++;
        if (decided.status === 'NEEDS_ATTENTION') {
          await this.alertManager(tenantId, created.id, stars, r, s, salonName).catch(() => undefined);
          alerted++;
        }
      } else {
        // Keep content fresh; never clobber a decision the manager already acted on.
        await this.prisma.googleReview.update({ where: { id: existing.id }, data: base });
      }
    }
    await this.writeSettings(tenantId, { lastSyncAt: new Date().toISOString() });
    return { fetched: reviews.length, drafted, alerted };
  }

  /** Star + text → status + optional draft reply. */
  private decide(stars: number, comment: string, s: GbrSettings, salonName: string, alreadyReplied: boolean, reviewerName: string): { status: GStatus; draft: string | null } {
    if (alreadyReplied) return { status: 'REPLIED', draft: null };
    // Low or neutral → always a human.
    if (stars <= s.alertMaxStars) return { status: 'NEEDS_ATTENTION', draft: null };
    // High star but the text complains → treat as needs-attention (smart guard).
    if (stars >= s.autoMinStars && this.negativeSignal(comment)) return { status: 'NEEDS_ATTENTION', draft: null };
    if (stars >= s.autoMinStars) {
      const draft = this.draftReply(stars, comment, s.tone, salonName, this.firstName(reviewerName));
      // approveFirst = draft & wait; otherwise it would be posted by the caller.
      return { status: 'DRAFTED', draft };
    }
    return { status: 'NEEDS_ATTENTION', draft: null };
  }

  private negativeSignal(comment: string): boolean {
    const c = (comment || '').toLowerCase();
    if (!c) return false;
    const bad = ['wait', 'waited', 'rude', 'dirty', 'unhappy', 'disappoint', 'refund', 'worst', 'never again', 'infection', 'hurt', 'overcharg', 'cold', 'broke', 'bad', 'terrible', 'awful', 'slow', 'expensive'];
    return bad.some((w) => c.includes(w));
  }

  private firstName(name: string | null | undefined): string {
    const n = (name || '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
  }

  /** Build a warm, varied reply. Varied by review id so replies aren't identical. */
  private draftReply(stars: number, comment: string, tone: GbrSettings['tone'], salonName: string, first: string): string {
    const hi = first ? `Hi ${first}, ` : 'Hi there, ';
    const salon = salonName || 'our salon';
    const warm = [
      `${hi}thank you so much for the kind words and the ${stars}-star review! We're so happy you enjoyed your visit and we can't wait to pamper you again at ${salon}. 💅`,
      `${hi}this made our whole team smile — thank you for the ${stars} stars! It means the world to us. See you again soon at ${salon}! 💕`,
      `${hi}we truly appreciate you taking the time to leave ${stars} stars. Thank you for trusting ${salon} — we look forward to your next visit!`,
    ];
    const pro = [
      `${hi}thank you for your ${stars}-star review. We're delighted you had a great experience and we look forward to welcoming you back to ${salon}.`,
      `${hi}we appreciate your feedback and the ${stars} stars. Thank you for choosing ${salon} — see you next time.`,
      `${hi}thank you for the wonderful review. It's a pleasure serving you at ${salon}, and we hope to see you again soon.`,
    ];
    const short = [
      `Thank you for the ${stars} stars! 💛 See you again soon.`,
      `We appreciate your review — thank you! 🌸`,
      `Thank you so much! It was a pleasure taking care of you. 💅`,
    ];
    const pool = tone === 'professional' ? pro : tone === 'short' ? short : warm;
    const idx = Math.abs(this.hash(comment + salon)) % pool.length;
    return pool[idx];
  }
  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
    return h;
  }

  // ---- manager alert -------------------------------------------------------
  private async salonName(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    return t?.name || 'your salon';
  }

  private async alertManager(tenantId: string, reviewRowId: string, stars: number, r: GoogleApiReview, s: GbrSettings, salonName: string) {
    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { contactEmail: true } });
    const to = (s.alertEmail || tenant?.contactEmail || n.senderEmail || '').trim();
    if (!to) return; // nowhere to send
    const transport = this.buildTransport(n, salonName);
    const who = r.reviewer?.displayName || 'A customer';
    const stded = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    const subject = `⚠️ New ${stars}-star Google review needs your attention`;
    const body = `${who} left a ${stars}-star review for ${salonName}.\n\n"${r.comment || '(no text)'}"\n\nWe did NOT auto-reply. Please respond personally on Google.`;
    const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
      <h2 style="color:#b91c1c;margin:0 0 6px">⚠️ New ${stars}-star review needs a personal reply</h2>
      <p style="color:#475569;margin:0 0 14px">${salonName}</p>
      <div style="border:1px solid #fee2e2;background:#fef2f2;border-radius:12px;padding:16px">
        <div style="font-size:20px;color:#f59e0b;letter-spacing:2px">${stded}</div>
        <div style="font-weight:700;color:#1e293b;margin:6px 0 4px">${who}</div>
        <div style="color:#334155;line-height:1.5">${(r.comment || '(no text left)').replace(/</g, '&lt;')}</div>
      </div>
      <p style="color:#64748b;font-size:14px;margin:16px 0 0">Lumio did <strong>not</strong> auto-reply to this one — negative and neutral reviews always go to you so you can respond personally and win the customer back.</p>
    </div>`;
    await this.notifications.send({
      tenantId, channel: NotificationChannel.EMAIL, recipient: to, subject, body, html,
      relatedType: 'google_review', relatedId: reviewRowId,
      smtp: transport.smtp, brevo: transport.brevo, gmail: transport.gmail,
      mailService: n.mailService, senderName: transport.senderName, replyTo: transport.replyTo,
    });
    await this.prisma.googleReview.update({ where: { id: reviewRowId }, data: { alertedAt: new Date() } });
  }

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
    return { smtp, brevo, gmail, senderName, replyTo };
  }

  // ---- inbox actions -------------------------------------------------------
  async list(user: AuthenticatedUser, status?: string) {
    const tenantId = this.tenantId(user);
    const where: { tenantId: string; status?: GStatus } = { tenantId };
    if (status && ['NEW', 'DRAFTED', 'REPLIED', 'NEEDS_ATTENTION', 'SKIPPED'].includes(status)) {
      where.status = status as GStatus;
    }
    const rows = await this.prisma.googleReview.findMany({
      where, orderBy: [{ status: 'asc' }, { reviewCreatedAt: 'desc' }], take: 200,
    });
    return rows;
  }

  /** Approve (and optionally edit) a drafted reply → post it to Google. */
  async approve(user: AuthenticatedUser, id: string, editedText?: string) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.googleReview.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Review not found');
    const text = (editedText && editedText.trim()) || row.draftReply || '';
    if (!text) throw new BadRequestException('No reply text to post.');
    const s = await this.getSettings(tenantId);
    await this.postReply(s, row.googleReviewId, text);
    await this.prisma.googleReview.update({ where: { id: row.id }, data: { status: 'REPLIED', replyText: text, repliedAt: new Date() } });
    await this.audit(tenantId, user.userId, 'google_reviews.reply_posted', row.id);
    return { ok: true };
  }

  async skip(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.googleReview.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Review not found');
    await this.prisma.googleReview.update({ where: { id: row.id }, data: { status: 'SKIPPED' } });
    await this.audit(tenantId, user.userId, 'google_reviews.skipped', row.id);
    return { ok: true };
  }

  private async postReply(s: GbrSettings, googleReviewId: string, text: string) {
    if (!s.accountId || !s.locationId) throw new BadRequestException('No Google location selected.');
    const token = await this.accessToken(s);
    const name = `${this.reviewsParent(s)}/reviews/${googleReviewId}`;
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${name}/reply`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ comment: text }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`Google reply failed (${res.status}). ${t.slice(0, 160)}`);
    }
  }

  // ---- audit ---------------------------------------------------------------
  private async audit(tenantId: string, userId: string | null, action: string, resourceId?: string) {
    try {
      await this.prisma.auditLog.create({
        data: { tenantId, userId: userId || null, action, resourceType: 'google_review', resourceId: resourceId || null },
      });
    } catch {
      /* audit must never break the main flow */
    }
  }
}

// Shape of a Google Business Profile v4 review (only the fields we use).
interface GoogleApiReview {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string; // ONE | TWO | THREE | FOUR | FIVE
  comment?: string;
  createTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}
