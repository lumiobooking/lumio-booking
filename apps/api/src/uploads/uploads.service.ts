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
/**
 * Connection options, with one deliberate loosening.
 *
 * Shared hosts are usually reached by IP or by a generic server name, and their
 * FTPS certificate is issued for neither — so strict verification rejects a
 * connection that is otherwise perfectly good. The practical consequence of
 * leaving it strict is not "people fix their certificates": it is that they
 * untick FTPS and send the password in clear text.
 *
 * So the certificate is not verified, and the connection is still encrypted.
 * That trades away proof of WHO the server is, and keeps the password off the
 * wire. For uploading a salon's own marketing photos to a host whose IP the
 * operator typed in themselves, that is the right way round — and it is
 * strictly better than the plaintext alternative it replaces.
 */
function accessOpts(c: FtpConfig) {
  return {
    host: c.host, port: c.port, user: c.user, password: c.password, secure: c.secure,
    ...(c.secure ? { secureOptions: { rejectUnauthorized: false } } : {}),
  };
}

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
      // Hostinger's panel shows the server as "ftp://46.202.196.218", so that is
      // what gets pasted in. basic-ftp wants a bare hostname and fails DNS on
      // anything else, with an error that looks like the server is unreachable.
      // Accepting what the panel displays is cheaper than explaining the
      // difference to every person who sets this up.
      host: host.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''),
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
      await client.access(accessOpts(c));
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

  /** The public base, so callers can tell OUR files from a salon's own links. */
  async publicBase(): Promise<string | null> {
    return (await this.config())?.publicBase ?? null;
  }

  /**
   * Delete files we uploaded, by their path inside our own bucket.
   *
   * Takes RELATIVE paths ("<tenant>/<uuid>.jpg"), never URLs. Building an FTP
   * delete from a URL is a way to delete somebody else's file; the caller
   * derives the path through storagePathOf(), which refuses anything that is
   * not ours and anything containing traversal.
   *
   * One connection for the whole batch — opening an FTP session per file is
   * most of the cost of a sweep.
   */
  async deletePaths(paths: string[]): Promise<{ deleted: number; failed: number }> {
    const c = await this.config();
    if (!c || !paths.length) return { deleted: 0, failed: 0 };
    const safe = paths.filter((p) => /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(p));

    const client = new FtpClient(20_000);
    let deleted = 0; let failed = 0;
    try {
      await client.access(accessOpts(c));
      for (const rel of safe) {
        try {
          await client.remove(`${c.basePath}/${rel}`);
          deleted += 1;
        } catch {
          // A file already gone is a success as far as the caller is concerned;
          // anything else is counted and moved past, because one bad path must
          // not strand the rest of the batch.
          failed += 1;
        }
      }
    } catch (e) {
      this.log.warn(`FTP cleanup could not connect: ${e instanceof Error ? e.message : e}`);
      return { deleted, failed: safe.length - deleted };
    } finally {
      client.close();
    }
    return { deleted, failed };
  }

  /** Super Admin "Test connection": connect, list the base dir, disconnect. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const c = await this.config();
    if (!c) return { ok: false, message: 'Fill in host, user, password and public URL first.' };
    const client = new FtpClient(15_000);
    try {
      await client.access(accessOpts(c));
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
