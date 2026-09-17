import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { oauthBase } from '../../common/public-url.util';

/**
 * PINTEREST, CONNECTED ONCE — by a button, not by a terminal.
 *
 * WHY THIS EXISTS
 *
 * The Trends feed needs a Pinterest refresh token. The first way to get one
 * was the manual OAuth dance: add a redirect URI, open an authorize link,
 * copy a code off the address bar, base64 the app id and secret, curl the
 * token endpoint, copy the right string out of the JSON, paste it into
 * Render. Five steps, three places to paste the wrong thing — and the
 * person doing it pasted the app secret where the app id went, left "CODE"
 * unreplaced, and screenshotted the secret twice. None of that is their
 * fault; it is what a terminal-only flow does to a non-programmer.
 *
 * This is the Google Drive pattern, again: the app id and secret sit in
 * Render as env vars (set once, never copied anywhere), the Super Admin
 * presses "Kết nối Pinterest", Pinterest sends the browser back here with a
 * code, the server exchanges it and stores the refresh token in
 * platform_config. The feed reads the token from there; the env var
 * PINTEREST_REFRESH_TOKEN still works for anyone who prefers it.
 *
 * One account for the whole platform: Trends is a public dataset, not a
 * salon's own data, so one agency login serves every tenant.
 */

export const PIN_SCOPES = ['trends:read', 'pins:read', 'boards:read', 'user_accounts:read'] as const;
const KEY_TOKEN = 'pinterest_refresh_token';
const KEY_USER = 'pinterest_user';
const KEY_AT = 'pinterest_connected_at';
const KEY_SCOPES = 'pinterest_scopes';
const API = 'https://api.pinterest.com/v5';

@Injectable()
export class PinterestConnectService implements OnModuleInit {
  private readonly log = new Logger('Pinterest');
  /** The stored refresh token, read once and kept: the feed asks synchronously. */
  private cached: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prime().catch(() => undefined);
  }

  private get rows() {
    return (this.prisma as unknown as {
      platformConfig?: {
        findUnique: (a: unknown) => Promise<{ value: string } | null>;
        upsert: (a: unknown) => Promise<unknown>;
        deleteMany: (a: unknown) => Promise<unknown>;
      };
    }).platformConfig;
  }

  private async read(key: string): Promise<string | null> {
    const row = await this.rows?.findUnique({ where: { key } }).catch(() => null);
    return row?.value?.trim() || null;
  }
  private async write(key: string, value: string) {
    await this.rows?.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  async prime() {
    this.cached = await this.read(KEY_TOKEN);
  }

  // ---- config ----------------------------------------------------------------
  private appId(): string { return (process.env.PINTEREST_APP_ID || '').trim(); }
  private appSecret(): string { return (process.env.PINTEREST_APP_SECRET || '').trim(); }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  /** Where Pinterest sends the browser back. Must be listed, character for character, in the Pinterest app. */
  redirectUri(): string {
    const own = (process.env.PINTEREST_REDIRECT_URI || '').trim().replace(/\/+$/, '');
    return own || `${oauthBase()}/api/content/pinterest/callback`;
  }
  private signingSecret(): string { return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-pinterest-signing-dev'; }
  private signState(): string {
    const payload = Buffer.from(JSON.stringify({ p: 'pinterest', exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): boolean {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return false;
    const expect = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { p: string; exp: number };
      return data.p === 'pinterest' && Date.now() <= data.exp;
    } catch { return false; }
  }

  // ---- what the feed asks ------------------------------------------------------

  /** The refresh token to use: the connected one, else the env var. Null = not connected. */
  refreshToken(): string | null {
    return this.cached || (process.env.PINTEREST_REFRESH_TOKEN || '').trim() || null;
  }

  // ---- what the screen asks ----------------------------------------------------

  async status() {
    const [user, at, scopes] = await Promise.all([this.read(KEY_USER), this.read(KEY_AT), this.read(KEY_SCOPES)]);
    const viaEnv = !this.cached && Boolean((process.env.PINTEREST_REFRESH_TOKEN || '').trim());
    return {
      connected: Boolean(this.refreshToken()),
      viaEnv,
      username: user,
      connectedAt: at,
      scopes: scopes ? scopes.split(',') : [],
      /** trends:read is the one the feed needs; a token without it connects and then 403s. */
      hasTrends: !scopes || scopes.includes('trends:read'),
      appReady: Boolean(this.appId() && this.appSecret()),
      redirectUri: this.redirectUri(),
      appId: this.appId() || null,
    };
  }

  authUrl(): { url: string } {
    if (!this.appId() || !this.appSecret()) {
      throw new BadRequestException('Chưa có PINTEREST_APP_ID / PINTEREST_APP_SECRET trên Render. Đặt hai biến đó rồi thử lại.');
    }
    const params = new URLSearchParams({
      client_id: this.appId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: PIN_SCOPES.join(','),
      state: this.signState(),
    });
    return { url: `https://www.pinterest.com/oauth/?${params.toString()}` };
  }

  /** Pinterest redirects here. Exchange the code, keep the refresh token, bounce back. */
  async callback(code: string, state: string, error?: string): Promise<string> {
    const back = (q: string) => `${this.webBase()}/super-admin/billing?${q}#pinterest`;
    if (!this.verifyState(state)) return back('pinterest=error&msg=state');
    if (error || !code) return back(`pinterest=error&msg=${encodeURIComponent(error || 'no_code')}`);
    try {
      const basic = Buffer.from(`${this.appId()}:${this.appSecret()}`).toString('base64');
      const res = await fetch(`${API}/oauth/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri() }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; message?: string; code?: number };
      if (!res.ok || !data.refresh_token) {
        return back(`pinterest=error&msg=${encodeURIComponent(data.message || `token ${res.status}`)}`);
      }
      // Who signed in — for the status card, and for spotting the wrong account.
      let username = '';
      if (data.access_token) {
        const who = await fetch(`${API}/user_account`, { headers: { authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(10_000) })
          .then((r) => r.json()).catch(() => ({})) as { username?: string };
        username = who.username ?? '';
      }
      await this.write(KEY_TOKEN, data.refresh_token);
      await this.write(KEY_AT, new Date().toISOString());
      await this.write(KEY_SCOPES, (data.scope || PIN_SCOPES.join(',')).replace(/\s+/g, ','));
      if (username) await this.write(KEY_USER, username);
      this.cached = data.refresh_token;
      this.log.log(`Pinterest connected${username ? ` as ${username}` : ''}`);
      return back('pinterest=ok');
    } catch (e) {
      return back(`pinterest=error&msg=${encodeURIComponent(e instanceof Error ? e.message : 'unknown')}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.rows?.deleteMany({ where: { key: { in: [KEY_TOKEN, KEY_USER, KEY_AT, KEY_SCOPES] } } }).catch(() => undefined);
    this.cached = null;
  }
}
