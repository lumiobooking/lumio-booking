import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import {
  TIKTOK_KEY, TIKTOK_DEFAULTS, TIKTOK_FILE_MAX_BYTES, type TikTokSettings, type TikTokPostOptions, type CreatorInfo,
  tiktokAuthorizeUrl, settingsFromToken, parseCreatorInfo, publicTikTok, accessStale, needsReconnect, targetOf,
  initBody, chunkPlan, explainTikTokError, tiktokPostUrl, readPublishStatus,
} from './tiktok';

const OPEN = 'https://open.tiktokapis.com/v2';

/**
 * The client's TikTok account, held by Lumio on the client's say-so.
 *
 * One OAuth grant per salon, stored as a Setting row like the Google one —
 * the salon connects from its own phone, the token lives here, the sweep
 * uses it at post time. The token never reaches a browser and never sits
 * on a post row (see social-publish's isolation rules): everything that
 * needs it comes through this service with a tenantId.
 */
@Injectable()
export class TikTokService {
  private readonly logger = new Logger('TikTok');
  constructor(private readonly prisma: PrismaService) {}

  // ---- config ----------------------------------------------------------------
  private clientKey(): string { return process.env.TIKTOK_CLIENT_KEY || ''; }
  private clientSecret(): string { return process.env.TIKTOK_CLIENT_SECRET || ''; }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  private redirectUri(): string { return `${this.apiBase()}/api/tiktok/callback`; }
  /** PULL_FROM_URL only works from a domain verified in the developer portal; off until it is. */
  private pullFromUrl(): boolean { return /^(1|true|yes)$/i.test(process.env.TIKTOK_PULL_FROM_URL || ''); }
  private signingSecret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-tiktok-signing-dev'; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
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
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; exp: number };
      if (!data.exp || Date.now() > data.exp) return null;
      return data.t;
    } catch { return null; }
  }

  // ---- settings --------------------------------------------------------------
  async getSettings(tenantId: string): Promise<TikTokSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: TIKTOK_KEY } } }).catch(() => null);
    const v = (row?.value ?? {}) as Partial<TikTokSettings>;
    return { ...TIKTOK_DEFAULTS, ...v };
  }
  private async writeSettings(tenantId: string, patch: Partial<TikTokSettings>): Promise<TikTokSettings> {
    const cur = await this.getSettings(tenantId);
    const next = { ...cur, ...patch };
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: TIKTOK_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: TIKTOK_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** What the screen shows. No token ever leaves here. */
  async status(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    return {
      ...publicTikTok(s),
      clientConfigured: Boolean(this.clientKey() && this.clientSecret()),
      redirectUri: this.redirectUri(),
    };
  }

  /** The planner's view of the connection — null when there is none. */
  async targetFor(tenantId: string) {
    const s = await this.getSettings(tenantId).catch(() => null);
    return targetOf(s);
  }

  // ---- OAuth -------------------------------------------------------------------
  async authUrl(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = this.tenantId(user);
    if (!this.clientKey() || !this.clientSecret()) {
      throw new BadRequestException('Nền tảng chưa cấu hình TikTok (thiếu TIKTOK_CLIENT_KEY). Báo đội Lumio.');
    }
    return { url: tiktokAuthorizeUrl({ clientKey: this.clientKey(), redirectUri: this.redirectUri(), state: this.signState(tenantId) }) };
  }

  /** TikTok sends the browser back here with ?code&state. Returns where to send it next. */
  async callback(code: string, state: string, error?: string): Promise<string> {
    // Land on the channels hub — the one screen that shows every connection.
    const back = (q: string) => `${this.webBase()}/salon/channels?${q}`;
    const tenantId = this.verifyState(state);
    if (!tenantId) return back('tiktok=error&msg=invalid_state');
    if (error || !code) return back(`tiktok=error&msg=${encodeURIComponent(error || 'no_code')}`);
    try {
      const res = await fetch(`${OPEN}/oauth/token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: this.clientKey(), client_secret: this.clientSecret(),
          code, grant_type: 'authorization_code', redirect_uri: this.redirectUri(),
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as Parameters<typeof settingsFromToken>[1];
      const cur = await this.getSettings(tenantId);
      const next = settingsFromToken({ ...cur, connectedAt: '' }, data);
      if (!res.ok || !next) {
        this.logger.warn(`tiktok token exchange failed for ${tenantId}: ${data.error ?? res.status} ${data.error_description ?? ''}`);
        return back(`tiktok=error&msg=${encodeURIComponent(data.error || (data.scope && !String(data.scope).includes('video.publish') ? 'scope_video_publish_missing' : 'token_exchange_failed'))}`);
      }
      // Who this is — the guidelines want the creator's name on screen.
      const me = await this.userInfo(next.accessToken).catch(() => null);
      const saved = await this.writeSettings(tenantId, {
        ...next,
        displayName: me?.display_name || cur.displayName || '',
        username: me?.username || cur.username || '',
        avatarUrl: me?.avatar_url || cur.avatarUrl || '',
      });
      await this.refreshCreatorInfo(tenantId, saved).catch(() => undefined);
      await this.audit(tenantId, null, 'tiktok.connected');
      return back('tiktok=connected');
    } catch (e) {
      this.logger.error(`tiktok callback failed: ${String(e)}`);
      return back('tiktok=error&msg=exception');
    }
  }

  async disconnect(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const s = await this.getSettings(tenantId);
    if (s.accessToken) {
      await fetch(`${OPEN}/oauth/revoke/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: this.clientKey(), client_secret: this.clientSecret(), token: s.accessToken }).toString(),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    await this.writeSettings(tenantId, { ...TIKTOK_DEFAULTS, displayName: s.displayName, username: s.username });
    await this.audit(tenantId, user.userId, 'tiktok.disconnected');
    return this.status(user);
  }

  private async userInfo(accessToken: string): Promise<{ display_name?: string; username?: string; avatar_url?: string } | null> {
    const res = await fetch(`${OPEN}/user/info/?fields=open_id,display_name,username,avatar_url`, {
      headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: { user?: { display_name?: string; username?: string; avatar_url?: string } } };
    return j.data?.user ?? null;
  }

  /** A live access token for this tenant, refreshed when its 24 hours are nearly up. */
  private async accessToken(tenantId: string): Promise<{ token: string; s: TikTokSettings }> {
    let s = await this.getSettings(tenantId);
    if (!s.connected || !s.refreshToken) throw new BadRequestException('Tiệm chưa kết nối TikTok.');
    if (needsReconnect(s)) throw new BadRequestException('Kết nối TikTok đã hết hạn — bấm "Kết nối lại TikTok".');
    if (!accessStale(s)) return { token: s.accessToken, s };
    const res = await fetch(`${OPEN}/oauth/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: this.clientKey(), client_secret: this.clientSecret(),
        grant_type: 'refresh_token', refresh_token: s.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Parameters<typeof settingsFromToken>[1];
    const next = settingsFromToken(s, { ...data, scope: data.scope ?? 'user.info.basic,video.publish' });
    if (!res.ok || !next) {
      const msg = `TikTok không làm mới được quyền (${data.error ?? res.status}). Bấm "Kết nối lại TikTok".`;
      await this.writeSettings(tenantId, { lastError: msg });
      throw new BadRequestException(msg);
    }
    s = await this.writeSettings(tenantId, next);
    return { token: s.accessToken, s };
  }

  // ---- creator info -------------------------------------------------------------

  /**
   * What this account may post: privacy levels, longest video, whether
   * comments/duet/stitch are off. Cached an hour on the connection; the
   * composer reads it to draw the dropdown, the sweep re-checks before
   * sending because TikTok requires it.
   */
  async refreshCreatorInfo(tenantId: string, pre?: TikTokSettings): Promise<CreatorInfo | null> {
    const { token } = await this.accessToken(tenantId);
    void pre;
    const res = await fetch(`${OPEN}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const info = parseCreatorInfo(j);
    if (!res.ok || !info || (j.error?.code && j.error.code !== 'ok')) {
      const msg = explainTikTokError(j.error?.code, j.error?.message);
      await this.writeSettings(tenantId, { lastError: msg });
      throw new BadRequestException(msg);
    }
    await this.writeSettings(tenantId, { creator: info, lastError: null });
    return info;
  }

  async creatorInfo(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const info = await this.refreshCreatorInfo(tenantId);
    return { creator: info };
  }

  private async freshCreator(tenantId: string): Promise<CreatorInfo | null> {
    const s = await this.getSettings(tenantId);
    const age = s.creator ? Date.now() - Date.parse(s.creator.checkedAt) : Infinity;
    if (s.creator && age < 60 * 60 * 1000) return s.creator;
    return this.refreshCreatorInfo(tenantId).catch(() => s.creator);
  }

  // ---- publishing ---------------------------------------------------------------

  /**
   * One video to the client's TikTok, the way the sweep calls it.
   *
   * creator_info first (TikTok requires it, and the privacy level has to be
   * one the account allows today), then init — PULL_FROM_URL when the media
   * host is verified in the portal, else the file is fetched and PUT in
   * chunks — then status/fetch until TikTok says complete or failed. The
   * publish id is returned even when processing is still running: TikTok
   * finishes in the background and the post shows up minutes later.
   */
  async publish(tenantId: string, input: { caption: string; videoUrl: string; opts: TikTokPostOptions }): Promise<{ publishId: string; postId: string | null; url: string | null; pending: boolean }> {
    const { token, s } = await this.accessToken(tenantId);
    const creator = await this.freshCreator(tenantId);
    if (creator && creator.privacyOptions.length && !creator.privacyOptions.includes(input.opts.privacy)) {
      throw new BadRequestException(explainTikTokError('privacy_level_option_mismatch'));
    }

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' };
    const init = async (body: unknown) => {
      const res = await fetch(`${OPEN}/post/publish/video/init/`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      const j = await res.json().catch(() => ({})) as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } };
      return { res, j };
    };

    let publishId = '';
    let pulled = false;
    if (this.pullFromUrl()) {
      const { res, j } = await init(initBody(input.caption, input.opts, { kind: 'url', url: input.videoUrl }));
      if (res.ok && j.data?.publish_id && (!j.error?.code || j.error.code === 'ok')) { publishId = j.data.publish_id; pulled = true; }
      else if (j.error?.code !== 'url_ownership_unverified') throw new BadRequestException(explainTikTokError(j.error?.code, j.error?.message));
      // url_ownership_unverified: fall through to the upload path below.
    }

    if (!pulled) {
      const file = await this.fetchVideo(input.videoUrl);
      const plan = chunkPlan(file.length);
      const { res, j } = await init(initBody(input.caption, input.opts, { kind: 'file', size: file.length, chunkSize: plan.chunkSize, chunks: plan.chunks }));
      if (!res.ok || !j.data?.publish_id || !j.data.upload_url || (j.error?.code && j.error.code !== 'ok')) {
        throw new BadRequestException(explainTikTokError(j.error?.code, j.error?.message));
      }
      publishId = j.data.publish_id;
      for (const [start, end] of plan.ranges) {
        const part = file.subarray(start, end + 1);
        const up = await fetch(j.data.upload_url, {
          method: 'PUT',
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(part.length),
            'content-range': `bytes ${start}-${end}/${file.length}`,
          },
          // A fresh Uint8Array over an ArrayBuffer: `Buffer` is typed over
          // ArrayBufferLike and fetch's BodyInit will not take it as-is.
          body: new Uint8Array(part),
          signal: AbortSignal.timeout(120_000),
        });
        if (!up.ok && up.status !== 206) {
          throw new BadRequestException(`TikTok không nhận được file (HTTP ${up.status} khi tải lên đoạn ${start}-${end}).`);
        }
      }
    }

    // Wait a little for TikTok to process — a phone-length clip is usually
    // through in under a minute. Past that the sweep records "pending" and
    // the post appears on its own.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      const st = await fetch(`${OPEN}/post/publish/status/fetch/`, { method: 'POST', headers, body: JSON.stringify({ publish_id: publishId }), signal: AbortSignal.timeout(15_000) })
        .then((r) => r.json()).catch(() => null);
      const read = readPublishStatus(st);
      if (read.ok) {
        const postId = read.postIds[0] ?? null;
        return { publishId, postId, url: tiktokPostUrl(s.username || null, postId), pending: false };
      }
      if (read.done) throw new BadRequestException(explainTikTokError(read.failReason, `publish ${publishId}`));
    }
    return { publishId, postId: null, url: null, pending: true };
  }

  /** The video, whole, for FILE_UPLOAD. Capped: a 1 GB export is not a TikTok clip. */
  private async fetchVideo(url: string): Promise<Buffer> {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new BadRequestException(`Không tải được video từ link (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > TIKTOK_FILE_MAX_BYTES) throw new BadRequestException(`Video nặng ${(len / 1048576).toFixed(0)} MB — Lumio gửi lên TikTok tối đa 128 MB. Xuất lại video nhẹ hơn (1080p, H.264).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > TIKTOK_FILE_MAX_BYTES) throw new BadRequestException('Video nặng quá 128 MB — xuất lại video nhẹ hơn.');
    if (!buf.length) throw new BadRequestException('File video rỗng.');
    return buf;
  }

  private async audit(tenantId: string, userId: string | null, action: string) {
    try {
      await this.prisma.auditLog.create({ data: { tenantId, userId: userId || null, action, resourceType: 'tiktok', resourceId: null } });
    } catch { /* audit is best-effort */ }
  }
}
