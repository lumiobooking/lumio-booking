import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';
import { PlatformConfigService } from '../billing/platform-config.service';

interface FtpConfig {
  host: string; port: number; user: string; password: string; secure: boolean;
  basePath: string; publicBase: string;
}

/**
 * Optional image storage over FTP/FTPS (Hostinger public_html, or any host that
 * serves a folder). When configured, uploaded photos are pushed to the salon's own
 * hosting and served from their domain — so the database never carries image bytes.
 * When NOT configured, callers keep the small inline (data URL) fallback.
 */
@Injectable()
export class UploadsService {
  private readonly log = new Logger(UploadsService.name);
  constructor(private readonly platform: PlatformConfigService) {}

  private async config(): Promise<FtpConfig | null> {
    const [host, port, user, password, secure, basePath, publicBase] = await Promise.all([
      this.platform.get('storage_ftp_host'),
      this.platform.get('storage_ftp_port'),
      this.platform.get('storage_ftp_user'),
      this.platform.get('storage_ftp_pass'),
      this.platform.get('storage_ftp_secure'),
      this.platform.get('storage_ftp_base_path'),
      this.platform.get('storage_public_base'),
    ]);
    if (!host || !user || !password || !publicBase) return null;
    return {
      host,
      port: parseInt(port || '21', 10) || 21,
      user,
      password,
      secure: String(secure) === 'true',
      basePath: (basePath || '').replace(/\/+$/, ''),
      publicBase: publicBase.replace(/\/+$/, ''),
    };
  }

  /** Is FTP storage set up? Used by the UI so it knows whether to upload or inline. */
  async status(): Promise<{ configured: boolean; publicBase: string; host: string; secure: boolean; basePath: string }> {
    const c = await this.config();
    return c
      ? { configured: true, publicBase: c.publicBase, host: c.host, secure: c.secure, basePath: c.basePath }
      : { configured: false, publicBase: '', host: '', secure: false, basePath: '' };
  }

  /** Decode a small data: image URL and push it to FTP, return its public https URL. */
  async uploadDataUrl(tenantId: string, dataUrl: string): Promise<string> {
    const c = await this.config();
    if (!c) throw new BadRequestException('STORAGE_NOT_CONFIGURED');

    const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec((dataUrl || '').trim());
    if (!m) throw new BadRequestException('Not a valid inline image.');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3_000_000) throw new BadRequestException('Image is too large (max 3MB).');

    // Group by tenant so one salon's uploads never collide with another's.
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
    const name = `${randomUUID()}.${ext}`;
    const remoteDir = `${c.basePath}/${safeTenant}`;
    const remotePath = `${remoteDir}/${name}`;

    const client = new FtpClient(20_000);
    try {
      await client.access({ host: c.host, port: c.port, user: c.user, password: c.password, secure: c.secure });
      await client.ensureDir(remoteDir);           // creates the folder if missing
      await client.uploadFrom(Readable.from(buf), name); // cwd is remoteDir after ensureDir
    } catch (e) {
      this.log.error(`FTP upload failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('Could not upload to storage. Check the FTP settings.');
    } finally {
      client.close();
    }
    return `${c.publicBase}/${safeTenant}/${name}`;
  }

  /** Super Admin "Test connection": connect, list the base dir, disconnect. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const c = await this.config();
    if (!c) return { ok: false, message: 'Fill in host, user, password and public URL first.' };
    const client = new FtpClient(15_000);
    try {
      await client.access({ host: c.host, port: c.port, user: c.user, password: c.password, secure: c.secure });
      if (c.basePath) await client.ensureDir(c.basePath);
      await client.list();
      return { ok: true, message: `Connected to ${c.host} ✓` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' };
    } finally {
      client.close();
    }
  }
}
