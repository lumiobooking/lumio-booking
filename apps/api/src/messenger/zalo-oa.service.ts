import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { MessengerService } from './messenger.service';
import * as crypto from 'crypto';
import {
  parseZaloEvent, refreshZaloToken, verifyZaloSignature,
  pkcePair, zaloPermissionUrl, exchangeZaloCode, fetchZaloOaInfo,
} from './zalo-oa';

/**
 * Zalo OA ↔ the Messenger brain.
 *
 * "One brain, many mouths" was already the architecture: a Facebook Page and
 * an Instagram account both route into the same handleMessage. A Zalo OA is
 * the third mouth. It gets a messenger_pages row (pageId = the OA id,
 * pageToken = the OA access token), so routing, threads, the inbox, handoff,
 * grace timers and the agent all work unchanged — the only Zalo-specific
 * pieces are the webhook signature, the send call, and the token dance.
 *
 * THE TOKEN DANCE
 *
 * Access tokens live ~25h, refresh tokens are single-use. Every inbound
 * webhook checks the expiry and refreshes when under two hours remain,
 * persisting the NEW pair before anything uses it. A bot that only speaks
 * when spoken to never needs a token fresher than its latest webhook.
 *
 * A salon connects by pasting four values from Zalo's developer console
 * (app id, app secret key, OA webhook secret, and the token pair from the
 * console's API explorer). No OAuth redirect flow — that can come later;
 * the console path works today and is what eSMS-style integrators document.
 */

export interface ZaloOaConfig {
  appId: string;
  /** App secret key — authorises token refresh (`secret_key` header). */
  appSecret: string;
  /** OA webhook secret — verifies X-ZEvent-Signature. */
  oaSecretKey: string;
  oaid: string;
  oaName?: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  enabled: boolean;
}

const KEY = 'zalo_oa';
/** The verifier parked while the OA admin is on Zalo's screen. Ten minutes. */
const PENDING_KEY = 'zalo_oauth_pending';
const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ZaloOaService {
  private readonly logger = new Logger('ZaloOA');

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new BadRequestException('No tenant context');
    return id;
  }

  private async configOf(tenantId: string): Promise<ZaloOaConfig | null> {
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: KEY }, select: { value: true } }).catch(() => null);
    const v = row?.value as unknown as ZaloOaConfig | null;
    return v?.oaid ? v : null;
  }

  private async saveConfig(tenantId: string, cfg: ZaloOaConfig): Promise<void> {
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: KEY } },
      update: { value: cfg as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: KEY, value: cfg as unknown as Prisma.InputJsonValue },
    });
  }

  /** Status for the settings panel — secrets stay on the server. */
  async status(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const cfg = await this.configOf(tenantId);
    // The market rides along so the screen that draws the panel can decide
    // for itself whether this salon is one Zalo is for, without a second call.
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } as never })
      .catch(() => null) as { market?: string | null } | null;
    return {
      market: tenant?.market ?? 'US',
      // One-click connect needs Lumio's own Zalo app on the server. Without
      // it the screen falls back to the console path, and says so.
      oauthReady: Boolean(this.platformApp()),
      connected: Boolean(cfg?.enabled && cfg?.accessToken),
      oaid: cfg?.oaid ?? '',
      oaName: cfg?.oaName ?? '',
      appId: cfg?.appId ?? '',
      tokenExpiresAt: cfg?.accessExpiresAtMs ? new Date(cfg.accessExpiresAtMs).toISOString() : null,
    };
  }

  /**
   * Connect (or reconnect) the OA. Creates the messenger_pages row that makes
   * the brain route this OA's messages, and — for a salon with no Facebook
   * connection — the minimal messenger_connections row the brain requires
   * (its per-tenant bot settings live there). An existing FB connection is
   * never touched: same brain, same instructions, one more mouth.
   */
  async connect(user: AuthenticatedUser, dto: {
    appId?: string; appSecret?: string; oaSecretKey?: string; oaid?: string;
    accessToken?: string; refreshToken?: string; oaName?: string;
  }) {
    const tenantId = this.tenantId(user);
    const prev = await this.configOf(tenantId);
    const cfg: ZaloOaConfig = {
      appId: String(dto.appId ?? prev?.appId ?? '').trim(),
      appSecret: String(dto.appSecret || prev?.appSecret || '').trim(),
      oaSecretKey: String(dto.oaSecretKey || prev?.oaSecretKey || '').trim(),
      oaid: String(dto.oaid ?? prev?.oaid ?? '').trim(),
      oaName: String(dto.oaName ?? prev?.oaName ?? '').trim(),
      accessToken: String(dto.accessToken || prev?.accessToken || '').trim(),
      refreshToken: String(dto.refreshToken || prev?.refreshToken || '').trim(),
      accessExpiresAtMs: dto.accessToken
        // A pasted token's age is unknown; assume the standard 25h minus safety.
        ? Date.now() + 20 * 60 * 60 * 1000
        : (prev?.accessExpiresAtMs ?? 0),
      enabled: true,
    };
    if (!cfg.appId || !cfg.oaid || !cfg.accessToken || !cfg.refreshToken) {
      throw new BadRequestException(
        'Cần đủ: App ID, OAID, Access token và Refresh token (lấy trong Zalo Developers → Công cụ khai thác API).',
      );
    }
    await this.applyConfig(tenantId, cfg);
    return this.status(user);
  }

  /**
   * Lumio's own Zalo app, from the environment — set once by the platform
   * owner, never typed by a salon. Absent means one-click is off and the
   * console path is the only one.
   */
  private platformApp(): { appId: string; appSecret: string; oaSecretKey: string } | null {
    const appId = (process.env.ZALO_APP_ID || '').trim();
    const appSecret = (process.env.ZALO_APP_SECRET || '').trim();
    const oaSecretKey = (process.env.ZALO_OA_SECRET_KEY || '').trim();
    return appId && appSecret ? { appId, appSecret, oaSecretKey } : null;
  }

  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  /** Where Zalo sends the OA admin back. Also what goes in the console's "Callback Url" box. */
  oauthRedirect(): string { return `${this.apiBase()}/api/public/zalo/oauth/callback`; }

  private signSecret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-zalo-signing'; }
  private signState(tenantId: string): string {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: Date.now() + PENDING_TTL_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): string | null {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', this.signSecret()).update(payload).digest('base64url');
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!d.exp || Date.now() > d.exp) return null;
      return d.t;
    } catch { return null; }
  }

  /**
   * The link the salon's button opens.
   *
   * A verifier is minted and parked on the tenant for ten minutes; only its
   * hash rides in the link. The state is the tenant id, signed, so the
   * callback can trust which salon this grant belongs to without a session.
   */
  async oauthUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = this.tenantId(user);
    const app = this.platformApp();
    if (!app) throw new BadRequestException('Zalo chưa được cấu hình phía Lumio (ZALO_APP_ID / ZALO_APP_SECRET).');
    const { verifier, challenge } = pkcePair();
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: PENDING_KEY } },
      update: { value: { verifier, at: Date.now() } as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: PENDING_KEY, value: { verifier, at: Date.now() } as unknown as Prisma.InputJsonValue },
    });
    return { url: zaloPermissionUrl({ appId: app.appId, redirectUri: this.oauthRedirect(), challenge, state: this.signState(tenantId) }) };
  }

  /**
   * Zalo sends the OA admin back here with ?code&oa_id&state.
   *
   * The code becomes the token pair, the token names the OA, and the OA is
   * wired exactly as a pasted connection would have been — same rows, same
   * brain. Every exit is a redirect to the bot page with a word on what
   * happened, because the person is standing on Zalo's screen and needs to
   * be walked back to ours.
   */
  async oauthCallback(code: string, oaIdHint: string, state: string): Promise<string> {
    const back = (q: string) => `${this.webBase()}/salon/messenger?${q}`;
    const tenantId = this.verifyState(state);
    if (!tenantId || !code) return back('zalo=error&msg=invalid_state');
    const app = this.platformApp();
    if (!app) return back('zalo=error&msg=not_configured');

    const pending = await this.prisma.setting.findFirst({ where: { tenantId, key: PENDING_KEY }, select: { value: true } }).catch(() => null);
    const pv = pending?.value as { verifier?: string; at?: number } | null;
    if (!pv?.verifier || !pv.at || Date.now() - pv.at > PENDING_TTL_MS) return back('zalo=error&msg=expired');
    // Single use: a verifier that stays behind can be replayed with a second code.
    await this.prisma.setting.deleteMany({ where: { tenantId, key: PENDING_KEY } }).catch(() => undefined);

    const tok = await exchangeZaloCode({ appId: app.appId, appSecret: app.appSecret, code, verifier: pv.verifier });
    if (!tok) return back('zalo=error&msg=token_exchange');

    // The token says which OA it is for; the query hint is only a fallback.
    const info = await fetchZaloOaInfo(tok.accessToken);
    const oaid = info?.oaid || String(oaIdHint || '').trim();
    if (!oaid) return back('zalo=error&msg=no_oa');

    const prev = await this.configOf(tenantId);
    await this.applyConfig(tenantId, {
      appId: app.appId,
      appSecret: app.appSecret,
      oaSecretKey: app.oaSecretKey || prev?.oaSecretKey || '',
      oaid,
      oaName: info?.name || prev?.oaName || '',
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken,
      accessExpiresAtMs: tok.expiresAtMs,
      enabled: true,
    });
    this.logger.log(`Zalo OA ${oaid} connected to tenant ${tenantId} via OAuth`);
    return back(`zalo=connected&oa=${encodeURIComponent(info?.name || oaid)}`);
  }

  /** Persist a config and wire the rows that make the brain route this OA. */
  private async applyConfig(tenantId: string, cfg: ZaloOaConfig): Promise<void> {
    await this.saveConfig(tenantId, cfg);

    // The mouth: route this OA id to this tenant.
    await this.prisma.messengerPage.upsert({
      where: { pageId: cfg.oaid },
      update: { tenantId, pageToken: cfg.accessToken, pageName: cfg.oaName || 'Zalo OA', enabled: true },
      create: { tenantId, pageId: cfg.oaid, pageToken: cfg.accessToken, pageName: cfg.oaName || 'Zalo OA', enabled: true },
    });

    // The brain's per-tenant row, only when the salon has none (Zalo-only salon).
    const conn = await this.prisma.messengerConnection.findUnique({ where: { tenantId } });
    if (!conn) {
      await this.prisma.messengerConnection.create({
        data: { tenantId, pageId: `zalo:${cfg.oaid}`, pageToken: cfg.accessToken, pageName: cfg.oaName || 'Zalo OA', enabled: true },
      });
    } else if (!conn.enabled && conn.pageId.startsWith('zalo:')) {
      await this.prisma.messengerConnection.update({ where: { tenantId }, data: { enabled: true } });
    }
  }

  async disconnect(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const cfg = await this.configOf(tenantId);
    if (cfg?.oaid) {
      await this.prisma.messengerPage.deleteMany({ where: { tenantId, pageId: cfg.oaid } });
      // A Zalo-only connection row goes too; a Facebook one is not ours to touch.
      await this.prisma.messengerConnection.deleteMany({ where: { tenantId, pageId: `zalo:${cfg.oaid}` } });
    }
    await this.prisma.setting.deleteMany({ where: { tenantId, key: KEY } });
    return { connected: false };
  }

  /** Refresh when under two hours remain. Persist FIRST — the refresh token
   *  is single-use, and a crash after refresh but before persist strands the
   *  OA until the owner pastes a new pair. */
  private async ensureFreshToken(tenantId: string, cfg: ZaloOaConfig): Promise<ZaloOaConfig> {
    if (!cfg.refreshToken || !cfg.appSecret) return cfg;
    if (cfg.accessExpiresAtMs - Date.now() > REFRESH_MARGIN_MS) return cfg;
    const fresh = await refreshZaloToken({ appId: cfg.appId, appSecret: cfg.appSecret, refreshToken: cfg.refreshToken });
    if (!fresh) {
      this.logger.warn(`Zalo token refresh failed for tenant ${tenantId} — replies may 401 until reconnect`);
      return cfg;
    }
    const next: ZaloOaConfig = { ...cfg, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, accessExpiresAtMs: fresh.expiresAtMs };
    await this.saveConfig(tenantId, next);
    await this.prisma.messengerPage.updateMany({ where: { pageId: cfg.oaid }, data: { pageToken: fresh.accessToken } }).catch(() => undefined);
    await this.prisma.messengerConnection.updateMany({ where: { tenantId, pageId: `zalo:${cfg.oaid}` }, data: { pageToken: fresh.accessToken } }).catch(() => undefined);
    return next;
  }

  /**
   * The webhook's whole job: authenticate, then hand the text to the brain.
   * Always resolves — Zalo retries unacknowledged events, and a forged or
   * malformed one earns a silent 200, same policy as the Meta webhook.
   */
  async handleWebhook(rawBody: string, signatureHeader: string | undefined): Promise<void> {
    let body: unknown = null;
    try { body = JSON.parse(rawBody || 'null'); } catch { return; }
    const ev = parseZaloEvent(body);
    if (!ev) return;

    // Route by OA id → tenant, via the same pages table every mouth uses.
    const page = await this.prisma.messengerPage.findFirst({ where: { pageId: ev.oaId } }).catch(() => null);
    if (!page || !page.enabled) return;
    let cfg = await this.configOf(page.tenantId);
    if (!cfg || !cfg.enabled) return;

    // Authenticate. No secret configured = nothing is accepted; a webhook that
    // skips verification "temporarily" is a webhook anyone on earth can call.
    const ts = (body as { timestamp?: unknown } | null)?.timestamp ?? '';
    // The webhook secret is per APP, not per OA: one for every salon that
    // connected through Lumio's app, kept in the environment. A pasted
    // (console-path) connection carries its own.
    const oaSecretKey = cfg.oaSecretKey || this.platformApp()?.oaSecretKey || '';
    if (!verifyZaloSignature({ appId: cfg.appId, rawBody, timestamp: String(ts), oaSecretKey, header: signatureHeader })) {
      this.logger.warn(`Zalo webhook signature rejected for OA ${ev.oaId}`);
      return;
    }

    // Keep the reply token alive, then let the brain do everything else.
    cfg = await this.ensureFreshToken(page.tenantId, cfg);
    await this.messenger.inboundZalo(ev.oaId, ev.senderId, ev.text, ev.tsMs);
  }
}
