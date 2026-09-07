import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';
import { PlatformConfigService } from '../billing/platform-config.service';
import { assemble, dropChunks, dropPieces, getResult, haveChunks, putChunk, putResult, CHUNK_MAX, PIECES_MAX, type FinishResult } from './chunk-store';
import { GoogleDriveService } from './google-drive.service';
import { EXT_BY_MIME, resolveMime } from './media-mime';

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
  constructor(
    private readonly platform: PlatformConfigService,
    private readonly drive: GoogleDriveService,
  ) {}

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

  /**
   * A real file from a phone — a photo or a clip — straight to the same store.
   *
   * WHY THIS EXISTS ALONGSIDE `uploadDataUrl`
   *
   * That one takes a base64 data URL, capped at 3MB, because it was written for
   * a compressed service photo. A thirty-second clip off a phone is thirty to
   * eighty megabytes; base64 makes it a third bigger again and it never
   * arrives. So the salon that has just filmed the thing the team asked for
   * either pastes a URL from somewhere else — which it does not have — or sends
   * the file in a group chat at eleven at night, unlabelled, which is the exact
   * step this whole feature exists to remove.
   *
   * The bytes take the same road as everything else: same FTP config, same
   * per-tenant folder, and the same check that the public URL actually serves
   * the file back. That check is not ceremony. An upload succeeding says the
   * bytes reached the server and nothing about whether the address serves them,
   * and the difference surfaces hours later as a Meta error nobody can act on.
   */
  async uploadFile(
    tenantId: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
  ): Promise<{ url: string; kind: 'image' | 'video' }> {
    const c = await this.config();
    if (!c) throw new BadRequestException('STORAGE_NOT_CONFIGURED');

    const buf = file?.buffer;
    if (!buf?.length) throw new BadRequestException('Chưa chọn được file.');

    // A phone can hand over a clip with an empty type; the filename still says .mov.
    const mime = resolveMime({ declared: file.mimetype, name: file.originalname });
    const isVideo = mime.startsWith('video/');
    const isImage = mime.startsWith('image/');
    if (!isVideo && !isImage) {
      throw new BadRequestException('Chỉ nhận ảnh hoặc video.');
    }
    // Generous for a clip, and still a bound. A phone that produces something
    // bigger than this produced a file nobody is going to post anyway.
    const cap = isVideo ? 120_000_000 : 12_000_000;
    if (buf.length > cap) {
      throw new BadRequestException(
        isVideo ? 'Clip nặng quá (tối đa 120MB). Quay ngắn lại hoặc gửi bản nén.'
          : 'Ảnh nặng quá (tối đa 12MB).');
    }

    // The extension comes from the MIME type, never from the uploaded name: a
    // filename is attacker-controlled and ends up inside a public URL.
    const ext = EXT_BY_MIME[mime] ?? (isVideo ? 'mp4' : 'jpg');
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
    const name = `${randomUUID()}.${ext}`;
    const remoteDir = `${c.basePath}/${safeTenant}`;

    const client = new FtpClient(60_000);
    try {
      await client.access(accessOpts(c));
      await client.ensureDir(remoteDir);
      await client.uploadFrom(Readable.from(buf), name);
    } catch (e) {
      this.log.error(`FTP upload failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('Không tải lên được. Thử lại giúp em.');
    } finally {
      client.close();
    }

    const url = `${c.publicBase}/${safeTenant}/${name}`;
    // A shared host can take a breath between the FTP write landing and the
    // web server serving it — a cache, a sync between two disks. Asking once,
    // the instant after the write, called a working upload broken and made
    // the shop send the whole clip again. Ask three times over a few seconds
    // before believing the address is really dead.
    let reachable: string | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise((r) => setTimeout(r, 2500 * attempt));
      reachable = await this.verifyPublic(url, isVideo ? 'video' : 'image');
      if (!reachable) break;
    }
    if (reachable) throw new BadRequestException(reachable);
    return { url, kind: isVideo ? 'video' : 'image' };
  }

  // ---- in pieces ------------------------------------------------------------------

  /** One piece of a file. Idempotent: the same piece twice is the same piece. */
  async receiveChunk(tenantId: string, dto: { uploadId: string; index: number; buf: Buffer }): Promise<{ have: number[] }> {
    const index = Math.round(Number(dto.index));
    if (!Number.isInteger(index) || index < 0 || index >= PIECES_MAX) throw new BadRequestException('Mảnh không hợp lệ.');
    if (!dto.buf?.length || dto.buf.length > CHUNK_MAX) throw new BadRequestException('Mảnh rỗng hoặc quá lớn.');
    try {
      await putChunk(tenantId, dto.uploadId, index, dto.buf);
    } catch (e) {
      this.log.error(`chunk write failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('Không nhận được mảnh này. Thử lại giúp em.');
    }
    return { have: await haveChunks(tenantId, dto.uploadId) };
  }

  /** Which pieces are already here, and the answer if `finish` has already run. */
  async chunkStatus(tenantId: string, uploadId: string): Promise<{ have: number[]; result: FinishResult | null }> {
    return { have: await haveChunks(tenantId, uploadId), result: await getResult(tenantId, uploadId) };
  }

  /**
   * The shop took an upload back (wrong clip). Pieces go now rather than at
   * the day's sweep; a finish already running is left to complete and its
   * result is simply never delivered.
   */
  async dropChunks(tenantId: string, uploadId: string): Promise<{ ok: true }> {
    if (!this.finishing.has(`${tenantId}/${uploadId}`)) await dropChunks(tenantId, uploadId).catch(() => undefined);
    return { ok: true };
  }

  /** Finishes in flight, so two "finish" calls for one upload do one job. */
  private finishing = new Map<string, Promise<FinishResult>>();
  /**
   * Finishes run ONE AT A TIME. Each holds a whole clip in memory (assembled,
   * then handed to Drive), and two shops — or one shop sending two things —
   * finishing together is two clips in memory on a small instance. A queue
   * costs the second clip a minute; running out of memory costs both.
   */
  private finishChain: Promise<unknown> = Promise.resolve();

  /**
   * Every piece is in: make the file and push it to storage — IN THE
   * BACKGROUND. The request answers at once with "working on it", and the
   * phone asks `chunkStatus` until the answer is there.
   *
   * Why not just do it inline: a 60MB clip takes a while to reach Hostinger,
   * and the proxy in front of the API drops any request that waits too long
   * for its response. That is exactly how the single-request upload died —
   * the bytes had arrived, and the phone was told "lost connection". The
   * answer is written next to the pieces, so even a phone whose own request
   * timed out gets it on the next ask.
   */
  async finishChunks(tenantId: string, dto: { uploadId: string; total: number; mime: string; name?: string }): Promise<{ pending: true } | FinishResult> {
    const total = Math.round(Number(dto.total));
    if (!Number.isInteger(total) || total < 1 || total > PIECES_MAX) throw new BadRequestException('Số mảnh không hợp lệ.');
    // A stored SUCCESS is the answer for good. A stored failure is not: the
    // phone re-sends the pieces and asks again, and must get a fresh attempt,
    // not yesterday's error handed back before anything was tried.
    const done = await getResult(tenantId, dto.uploadId);
    if (done?.url) return done;
    const key = `${tenantId}/${dto.uploadId}`;
    if (!this.finishing.has(key)) {
      const have = await haveChunks(tenantId, dto.uploadId);
      if (have.length < total || have.some((i, k) => i !== k)) {
        throw new BadRequestException(`MISSING_CHUNKS:${have.join(',')}`);
      }
      const turn = this.finishChain;
      const job = (async (): Promise<FinishResult> => {
        await turn.catch(() => undefined);
        let r: FinishResult;
        try {
          const buf = await assemble(tenantId, dto.uploadId, total);
          if (!buf) throw new Error('MISSING_CHUNKS:');
          const out = await this.storeMedia(tenantId, { buffer: buf, mimetype: dto.mime, originalname: dto.name });
          r = { ...out, at: Date.now() };
        } catch (e) {
          r = { error: e instanceof Error ? e.message : 'failed', at: Date.now() };
        }
        await putResult(tenantId, dto.uploadId, r).catch(() => undefined);
        await dropPieces(tenantId, dto.uploadId).catch(() => undefined);
        this.finishing.delete(key);
        return r;
      })();
      this.finishing.set(key, job);
      this.finishChain = job;
    }
    // Give a fast finish (a photo) its answer in this same request; a slow
    // one (a clip) gets "pending" and the phone polls.
    const r = await Promise.race<FinishResult | null>([
      this.finishing.get(key)!,
      new Promise<null>((res) => setTimeout(() => res(null), 8_000)),
    ]);
    return r ?? { pending: true };
  }

  /**
   * Where a shop's photo or clip LIVES.
   *
   * Drive, when it is connected. The hosting was the wrong place for the
   * archive: a hundred salons sending originals fills a shared host in a
   * season and slows every booking page on it, while the Drive account was
   * bought for exactly this. So the file of record goes to the salon's
   * Drive folder; the hosting gets a copy only when a post needs a public
   * address to fetch from (see SuggestionsService.stage), and that copy is
   * swept once the post has gone out. No Drive: the old FTP path, unchanged.
   */
  async storeMedia(
    tenantId: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
  ): Promise<{ url: string; kind: 'image' | 'video'; driveFileId?: string; driveUrl?: string; thumbUrl?: string }> {
    const mime = resolveMime({ declared: file.mimetype, name: file.originalname });
    const isVideo = mime.startsWith('video/');
    const isImage = mime.startsWith('image/');
    if (!isVideo && !isImage) throw new BadRequestException('Chỉ nhận ảnh hoặc video.');
    if (!(await this.drive.configured())) return this.uploadFile(tenantId, file);

    const cap = isVideo ? 120_000_000 : 12_000_000;
    if (file.buffer.length > cap) {
      throw new BadRequestException(isVideo ? 'Clip nặng quá (tối đa 120MB). Quay ngắn lại hoặc gửi bản nén.' : 'Ảnh nặng quá (tối đa 12MB).');
    }
    const ext = EXT_BY_MIME[mime] ?? (isVideo ? 'mp4' : 'jpg');
    const day = new Date().toISOString().slice(0, 10);
    const base = String(file.originalname ?? '').replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || (isVideo ? 'clip' : 'photo');
    const name = `${day}_${base}_${randomUUID().slice(0, 6)}.${ext}`;
    try {
      const f = await this.drive.store(tenantId, name, mime, file.buffer);
      return { url: f.url, kind: isVideo ? 'video' : 'image', driveFileId: f.id, driveUrl: f.url, thumbUrl: f.thumbUrl };
    } catch (e) {
      this.log.error(`Drive store failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('Không lưu được vào Google Drive. Thử lại giúp em.');
    }
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
    const url = `${c.publicBase}/${safeTenant}/${name}`;

    // ---- prove the file is actually readable from the internet ----
    //
    // The FTP upload succeeding says the bytes reached the server. It says
    // NOTHING about whether the public URL serves them, and those two are
    // different questions: the wrong Public URL, a domain not pointing at this
    // hosting, a .htaccess that swallows unknown paths, or a folder path that
    // does not correspond to the web address all produce a perfectly successful
    // upload and a URL that returns a 404.
    //
    // Failing here costs one HTTP request. NOT failing here costs a photo that
    // looks fine in the composer, a post that sits in the queue until its slot,
    // and then a Meta error reading "Missing or invalid image file" — hours
    // later, pointing at nothing anybody can act on.
    const reachable = await this.verifyPublic(url);
    if (reachable) throw new BadRequestException(reachable);

    return url;
  }

  /**
   * Fetch our own upload back. Returns a problem sentence, or null when fine.
   *
   * The message names the URL, because the fix is almost always in the "Public
   * URL of the upload folder" setting and the person reading it needs to see
   * what the two halves produced together.
   */
  private async verifyPublic(url: string, expect: 'image' | 'video' = 'image'): Promise<string | null> {
    try {
      // GET, not HEAD: some shared hosts answer HEAD differently or not at all,
      // and a false alarm here would block a working upload. A RANGE request
      // for a clip: the point is the headers, not eighty megabytes coming back.
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: expect === 'video' ? { range: 'bytes=0-0' } : {} });
      if (!res.ok) {
        return `Ảnh đã tải lên máy chủ nhưng địa chỉ công khai không mở được (HTTP ${res.status}): ${url} — `
          + 'kiểm tra ô "Public URL of the upload folder" có khớp với "Folder path on the server" không, '
          + 'và tên miền đã trỏ về hosting này chưa.';
      }
      const type = res.headers.get('content-type') || '';
      // What kind of file the address serves back. A clip answers video/mp4
      // (or, on a host that never learnt the extension, application/octet-stream
      // — which is a file, not a page). A WordPress 404 answers 200 with
      // text/html; checking the status alone would call that a success and
      // hand Meta a web page. The first version only knew about images and
      // refused every clip that had, in fact, arrived.
      const ok = expect === 'video'
        ? /^(video\/|application\/octet-stream)/i.test(type)
        : /^image\//i.test(type);
      if (!ok) {
        return `Địa chỉ file trả về "${type || 'không rõ loại'}" chứ không phải ${expect === 'video' ? 'file video' : 'file ảnh'}: ${url} — `
          + 'nhiều khả năng website đang nuốt đường dẫn này (WordPress trả về trang 404) '
          + 'hoặc ô "Public URL" trỏ sai chỗ.';
      }
      return null;
    } catch (e) {
      return `Không mở được ảnh vừa tải lên: ${url} (${e instanceof Error ? e.message : 'lỗi mạng'}). `
        + 'Thử dán địa chỉ đó vào trình duyệt xem hiện gì.';
    }
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

  /**
   * Prove the whole chain, end to end, and say where it broke.
   *
   * WHAT THE OLD VERSION ACTUALLY TESTED
   *
   * It connected, called ensureDir(basePath) and reported success. ensureDir
   * CREATES the directory when it is missing — so a wrong folder path produced
   * a green tick and a freshly created folder in the wrong place. The check
   * could not fail for the one mistake it existed to catch, and it did not:
   * a real setup showed "Connected ✓" while every uploaded photo was landing
   * somewhere no web address reached.
   *
   * The FTP half succeeding and the HTTP half succeeding are separate facts,
   * and on shared hosting with several websites they come apart constantly: an
   * FTP account belongs to ONE website, and the Public URL can name a different
   * one. Nothing about a successful login reveals that.
   *
   * So this walks the whole path and writes down each step: where the account
   * lands, what is there, whether the folder exists WITHOUT creating it, and
   * finally whether a file written over FTP can be read back over HTTPS.
   */
  async test(): Promise<{ ok: boolean; message: string }> {
    const c = await this.config();
    if (!c) return { ok: false, message: 'Điền host, user, password và Public URL trước đã.' };

    const lines: string[] = [];
    const client = new FtpClient(15_000);
    let probe: string | null = null;

    try {
      await client.access(accessOpts(c));
      lines.push(`✓ Đăng nhập FTP ${c.host} thành công.`);

      // Where does this account actually land? On Hostinger an account named
      // after a domain is locked to that domain's folder, and this line is what
      // tells the two cases apart.
      const home = await client.pwd().catch(() => '?');
      const rootList = await client.list().catch(() => []);
      const names = rootList.slice(0, 8).map((f: { name: string }) => f.name).join(", ");
      lines.push(`• Tài khoản đang đứng ở: ${home}`);
      lines.push(`• Thư mục gốc chứa: ${names || '(trống)'}`);

      // cd, NOT ensureDir. Creating the folder is what made the old check
      // useless: it could not tell "the path is right" from "the path was
      // wrong and I have just made it".
      try {
        await client.cd(c.basePath);
      } catch {
        return {
          ok: false,
          message: [
            ...lines,
            `✕ Không tìm thấy thư mục "${c.basePath}" từ tài khoản này.`,
            'Đường dẫn phải tính TỪ chỗ tài khoản đang đứng ở trên, không phải từ gốc máy chủ.',
            'Nếu tài khoản FTP thuộc website khác với Public URL thì sẽ luôn lệch — tạo tài khoản FTP cho đúng website đó.',
          ].join('\n'),
        };
      }
      lines.push(`✓ Vào được thư mục ${c.basePath}.`);

      // The half nobody checks: can the file be read back from the web?
      probe = `lumio-check-${randomUUID()}.txt`;
      await client.uploadFrom(Readable.from(Buffer.from('lumio storage check')), probe);
      lines.push('✓ Ghi file thử qua FTP thành công.');
    } catch (e) {
      return { ok: false, message: [...lines, `✕ ${e instanceof Error ? e.message : 'Kết nối thất bại'}`].join('\n') };
    }

    const url = `${c.publicBase}/${probe}`;
    const problem = await this.verifyPublic(url);
    await client.remove(probe).catch(() => undefined);
    client.close();

    if (problem) {
      return {
        ok: false,
        message: [
          ...lines,
          `✕ Nhưng KHÔNG đọc lại được qua web: ${url}`,
          problem,
          'Ghi được mà đọc không được = tài khoản FTP và Public URL đang trỏ vào hai website khác nhau.',
        ].join('\n'),
      };
    }

    return {
      ok: true,
      message: [...lines, `✓ Đọc lại được qua web: ${c.publicBase}`, '✓ Kho ảnh sẵn sàng.'].join('\n'),
    };
  }
}
