import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformConfigService } from '../billing/platform-config.service';

/**
 * Google Drive as the archive of what salons send in.
 *
 * WHY DRIVE, AND WHY NOT INSTEAD OF THE FTP STORE
 *
 * The FTP store exists because Facebook and Instagram fetch a post's media from
 * a public URL at publish time; Drive cannot be that URL. But the FTP folder is
 * a bucket of UUID filenames nobody browses, and the agency wanted the thing an
 * agency actually wants: every salon's footage in a folder with the salon's
 * name on it, in a Drive they already open every day, where a person can
 * scroll, download and sort. So both: FTP is where a post is published from,
 * Drive is where a human finds the file.
 *
 * ONE LOGIN, THE AGENCY'S OWN, AND THE NARROWEST SCOPE THAT WORKS
 *
 * Two designs were on the table. A service account is simpler to wire and has
 * a trap: since 2021 a file it creates in somebody's My Drive folder counts
 * against the SERVICE ACCOUNT's own 15GB, which cannot be raised — about three
 * hundred clips, across every salon combined, and then it stops. So instead the
 * agency's own Google account signs in once, and files belong to it and use its
 * storage, which can be bought.
 *
 * The scope is `drive.file`: the app may only touch files and folders IT
 * created. That is why the app makes the folders rather than the person — a
 * folder somebody made by hand is invisible to this scope. In exchange the
 * scope is classed as non-sensitive, so Google asks for no verification and
 * the consent screen carries no warning. The folders appear in the agency's
 * Drive like any other and can be renamed or moved; they are tracked by id.
 *
 * NOTHING HERE MAY MAKE A SALON WAIT
 *
 * A shop uploading a clip on phone data is already waiting on the FTP upload.
 * The Drive copy happens afterwards, on the server, from the public URL the
 * FTP upload produced — and if Drive is not configured, or the token has gone
 * stale, or Google is having an afternoon, the shop's upload still succeeded
 * and the copy is retried on the next sweep. See `mirror`.
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Lumio Booking';

/** What a salon's stored Drive pointer looks like. */
interface TenantDrive { folderId: string; folderUrl: string; name: string }

@Injectable()
export class GoogleDriveService {
  private readonly log = new Logger(GoogleDriveService.name);
  /** The access token, refreshed a minute before it would expire. */
  private cached: { token: string; until: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformConfigService,
  ) {}

  // ---- configuration ---------------------------------------------------------

  private async clientId(): Promise<string> {
    return (await this.platform.get('google_client_id')) || process.env.GBP_CLIENT_ID || '';
  }
  private async clientSecret(): Promise<string> {
    return (await this.platform.get('google_client_secret')) || process.env.GBP_CLIENT_SECRET || '';
  }
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  }
  private webBase(): string {
    const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim();
    return (process.env.PUBLIC_WEB_URL || cors || 'https://lumiobooking.com').replace(/\/$/, '');
  }
  redirectUri(): string {
    return `${this.apiBase()}/api/storage/gdrive/callback`;
  }

  /** Whether the archive is on at all. Cheap; asked before every mirror. */
  async configured(): Promise<boolean> {
    return Boolean(await this.platform.get('gdrive_refresh_token'));
  }

  async status(): Promise<{ connected: boolean; email: string | null; rootFolderUrl: string | null; clientReady: boolean; redirectUri: string }> {
    const [token, email, root, id, secret] = await Promise.all([
      this.platform.get('gdrive_refresh_token'),
      this.platform.get('gdrive_email'),
      this.platform.get('gdrive_root_folder_id'),
      this.clientId(),
      this.clientSecret(),
    ]);
    return {
      connected: Boolean(token),
      email: email || null,
      rootFolderUrl: root ? `https://drive.google.com/drive/folders/${root}` : null,
      clientReady: Boolean(id && secret),
      redirectUri: this.redirectUri(),
    };
  }

  // ---- the one-time sign-in ----------------------------------------------------

  private signingSecret(): string {
    return process.env.JWT_SECRET || process.env.APP_SECRET || 'lumio-gdrive-signing-dev';
  }
  private signState(): string {
    const payload = Buffer.from(JSON.stringify({ p: 'gdrive', exp: Date.now() + 600_000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
  private verifyState(state: string): boolean {
    const [payload, sig] = (state || '').split('.');
    if (!payload || !sig) return false;
    const expect = crypto.createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
    if (sig !== expect) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { p: string; exp: number };
      return data.p === 'gdrive' && Date.now() <= data.exp;
    } catch { return false; }
  }

  async authUrl(): Promise<{ url: string }> {
    const id = await this.clientId();
    if (!id || !(await this.clientSecret())) {
      throw new BadRequestException('Chưa có Google Client ID / Secret. Điền ở mục cấu hình rồi thử lại.');
    }
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      // `consent` every time, or Google hands back no refresh token on the
      // second connection and the archive silently stops.
      prompt: 'consent',
      state: this.signState(),
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /** Google redirects here. Store the refresh token, learn the email, bounce back. */
  async callback(code: string, state: string): Promise<string> {
    const back = (q: string) => `${this.webBase()}/super-admin/billing?${q}`;
    if (!this.verifyState(state)) return back('gdrive=error&msg=state');
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: await this.clientId(),
          client_secret: await this.clientSecret(),
          redirect_uri: this.redirectUri(),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string };
      if (!res.ok || !data.refresh_token) return back(`gdrive=error&msg=${encodeURIComponent(data.error || 'no_refresh_token')}`);

      let email = '';
      if (data.access_token) {
        const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { authorization: `Bearer ${data.access_token}` },
        }).then((r) => r.json()).catch(() => ({})) as { email?: string };
        email = who.email ?? '';
      }
      await this.platform.setMany({ gdrive_refresh_token: data.refresh_token, gdrive_email: email || undefined });
      this.cached = null;
      // Make the root folder now, while the person is watching, so the status
      // card can show a link to it the moment they land back.
      await this.rootFolderId().catch((e) => this.log.warn(`root folder: ${e instanceof Error ? e.message : e}`));
      return back('gdrive=ok');
    } catch (e) {
      return back(`gdrive=error&msg=${encodeURIComponent(e instanceof Error ? e.message : 'unknown')}`);
    }
  }

  async disconnect(): Promise<void> {
    // The refresh token is revoked at Google too, so a stale copy of it in a
    // backup somewhere is worth nothing.
    const token = await this.platform.get('gdrive_refresh_token');
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
    }
    await this.prisma.platformConfig.deleteMany({
      where: { key: { in: ['gdrive_refresh_token', 'gdrive_email', 'gdrive_root_folder_id'] } },
    });
    this.cached = null;
  }

  // ---- talking to Drive ---------------------------------------------------------

  private async accessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.until) return this.cached.token;
    const refresh = await this.platform.get('gdrive_refresh_token');
    if (!refresh) throw new BadRequestException('Google Drive chưa kết nối.');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: await this.clientId(),
        client_secret: await this.clientSecret(),
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      throw new BadRequestException(`Google từ chối làm mới phiên (${data.error ?? res.status}). Kết nối lại Google Drive trong Super Admin.`);
    }
    this.cached = { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000 };
    return data.access_token;
  }

  private async api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${DRIVE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Drive ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Find-or-create a folder by name under a parent. Only sees what this app made. */
  private async folder(name: string, parentId: string | null): Promise<{ id: string }> {
    const q = [
      `mimeType='${FOLDER}'`,
      `name='${name.replace(/'/g, "\\'")}'`,
      'trashed=false',
      parentId ? `'${parentId}' in parents` : `'root' in parents`,
    ].join(' and ');
    const found = await this.api<{ files: { id: string }[] }>(`/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
    if (found.files?.[0]) return found.files[0];
    return this.api<{ id: string }>('/files?fields=id', {
      method: 'POST',
      json: { name, mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) },
    });
  }

  /** The "Lumio Booking" folder in the agency's Drive, made once and remembered. */
  private async rootFolderId(): Promise<string> {
    const stored = await this.platform.get('gdrive_root_folder_id');
    if (stored) return stored;
    const f = await this.folder(ROOT_NAME, null);
    await this.platform.setMany({ gdrive_root_folder_id: f.id });
    return f.id;
  }

  /**
   * This salon's folder — made the first time anything of theirs is archived.
   *
   * Named after the salon with its slug in brackets, because two salons called
   * "Lux Nails" in two cities is not a hypothetical, and the folder is what a
   * person reads.
   */
  async folderForTenant(tenantId: string): Promise<TenantDrive> {
    const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: 'google_drive' }, select: { id: true, value: true } })
      .catch(() => null);
    const v = (existing?.value ?? null) as Partial<TenantDrive> | null;
    if (v?.folderId) return { folderId: v.folderId, folderUrl: v.folderUrl ?? `https://drive.google.com/drive/folders/${v.folderId}`, name: v.name ?? '' };

    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
    const name = `${(t?.name ?? 'Salon').trim()} (${t?.slug ?? tenantId.slice(0, 8)})`;
    const root = await this.rootFolderId();
    const f = await this.folder(name, root);
    const row: TenantDrive = { folderId: f.id, folderUrl: `https://drive.google.com/drive/folders/${f.id}`, name };
    if (existing) await this.prisma.setting.update({ where: { id: existing.id }, data: { value: row as never } });
    else await this.prisma.setting.create({ data: { tenantId, key: 'google_drive', value: row as never } });
    return row;
  }

  /** The salon's folder link if one exists, without creating anything. */
  async folderLink(tenantId: string): Promise<string | null> {
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: 'google_drive' }, select: { value: true } }).catch(() => null);
    const v = (row?.value ?? null) as Partial<TenantDrive> | null;
    return v?.folderUrl ?? (v?.folderId ? `https://drive.google.com/drive/folders/${v.folderId}` : null);
  }

  /**
   * Put one file in the salon's folder. Multipart upload: metadata + bytes in
   * one request, which is what Google recommends under 5MB and tolerates well
   * above it for the sizes a phone produces.
   */
  async upload(tenantId: string, name: string, mime: string, bytes: Buffer): Promise<{ id: string; url: string }> {
    const { folderId } = await this.folderForTenant(tenantId);
    const boundary = `lumio-${crypto.randomBytes(8).toString('hex')}`;
    const meta = JSON.stringify({ name, parents: [folderId] });
    const head = Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
      + `--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`, 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([head, bytes, tail]);

    const token = await this.accessToken();
    const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive upload ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = (await res.json()) as { id: string; webViewLink?: string };
    return { id: data.id, url: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` };
  }

  /**
   * Copy a file that is already on the public FTP store into Drive.
   *
   * From the URL rather than from the request: the shop's upload has already
   * finished and returned by the time this runs, so nothing here can make a
   * person on phone data wait. Failures are logged and left for the sweep.
   */
  async mirrorFromUrl(tenantId: string, url: string, name: string): Promise<{ url: string } | null> {
    if (!(await this.configured())) return null;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
    const mime = res.headers.get('content-type') || (/\.(mp4|mov|webm|m4v)$/i.test(url) ? 'video/mp4' : 'image/jpeg');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('empty body');
    const out = await this.upload(tenantId, name, mime.split(';')[0], bytes);
    return { url: out.url };
  }
}
