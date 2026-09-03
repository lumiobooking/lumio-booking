import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { MessengerService } from './messenger.service';
import { parseZaloEvent, refreshZaloToken, verifyZaloSignature } from './zalo-oa';

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
const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000;

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
    return {
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
    return this.status(user);
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
    if (!verifyZaloSignature({ appId: cfg.appId, rawBody, timestamp: String(ts), oaSecretKey: cfg.oaSecretKey, header: signatureHeader })) {
      this.logger.warn(`Zalo webhook signature rejected for OA ${ev.oaId}`);
      return;
    }

    // Keep the reply token alive, then let the brain do everything else.
    cfg = await this.ensureFreshToken(page.tenantId, cfg);
    await this.messenger.inboundZalo(ev.oaId, ev.senderId, ev.text, ev.tsMs);
  }
}
