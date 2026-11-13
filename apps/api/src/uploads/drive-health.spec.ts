import { driveProblem, GoogleDriveService, mirrorCapBytes, readCapped } from './google-drive.service';
import { SocialPublishService } from '../content/social-publish.service';

/**
 * 13/11/2026 — posts stopped getting their Drive folder on every salon from
 * 10/11 while the status card still read "Đã kết nối": it only looked at
 * whether a token was stored. Drive is now asked, and missed posts are
 * caught up once it answers again.
 */
describe('why Drive is not answering', () => {
  it('names a dropped sign-in, a bad client and a full Drive', () => {
    expect(driveProblem('Google từ chối làm mới phiên (invalid_grant).')).toMatch(/Kết nối lại/);
    expect(driveProblem('invalid_client')).toMatch(/Client ID/);
    expect(driveProblem('Drive 403: storageQuotaExceeded')).toMatch(/đầy/);
    expect(driveProblem('Drive 401: nope')).toMatch(/Kết nối lại/);
    expect(driveProblem('socket hang up')).toMatch(/không trả lời/);
  });
});

describe('the Drive status', () => {
  const make = (api: () => Promise<unknown>, token: string | null = 'tok') => {
    const svc = new GoogleDriveService({} as never, { get: async (k: string) => (k === 'gdrive_refresh_token' ? token : null) } as never);
    (svc as unknown as { api: () => Promise<unknown> }).api = api;
    return svc;
  };
  it('is working when Drive answers', async () => {
    expect(await make(async () => ({ storageQuota: { limit: '100', usage: '10' } })).check()).toEqual({ working: true, problem: null, full: false });
  });
  it('says so when the stored sign-in is dead', async () => {
    const out = await make(async () => { throw new Error('Google từ chối làm mới phiên (invalid_grant).'); }).check();
    expect(out.working).toBe(false);
    expect(out.problem).toMatch(/Kết nối lại/);
  });
  it('warns when the Drive is full', async () => {
    const out = await make(async () => ({ storageQuota: { limit: '100', usage: '99' } })).check();
    expect(out).toEqual(expect.objectContaining({ working: true, full: true }));
  });
  it('is simply off when nothing is connected', async () => {
    expect(await make(async () => ({}), null).check()).toEqual({ working: false, problem: null, full: false });
  });
});

describe('catching up posts that missed their Drive folder', () => {
  type Row = { id: string; tenantId: string; driveFolderUrl: string | null; scheduledAt: Date; media: { url: string; driveUrl?: string }[]; message: string };
  function world(working: boolean) {
    const rows: Row[] = [
      { id: 'a1', tenantId: 'A', driveFolderUrl: null, scheduledAt: new Date(), media: [{ url: 'https://m/x.jpg' }], message: 'A post' },
      { id: 'b1', tenantId: 'B', driveFolderUrl: null, scheduledAt: new Date(), media: [{ url: 'https://m/y.jpg' }], message: 'B post' },
      { id: 'a2', tenantId: 'A', driveFolderUrl: null, scheduledAt: new Date(), media: [], message: 'no picture' },
    ];
    const calls: string[] = [];
    const drive = {
      configured: async () => true,
      check: async () => ({ working, problem: null, full: false }),
      postFolder: async (tenantId: string) => ({ folderId: `f-${tenantId}`, folderUrl: `https://drive/f-${tenantId}` }),
      mirrorFromUrl: async (tenantId: string, url: string, _n: string, _k: unknown, folderId: string) => { calls.push(`${tenantId}:${folderId}:${url}`); return { url: `https://drive/file-${tenantId}` }; },
    };
    const prisma = {
      scheduledPost: {
        findMany: async () => rows.filter((r) => !r.driveFolderUrl),
        findFirst: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
        updateMany: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { Object.assign(rows.find((r) => r.id === where.id)!, data); return { count: 1 }; },
      },
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    };
    const svc = new SocialPublishService(prisma as never, {} as never, drive as never);
    return { svc, rows, calls };
  }

  it("files each post in its OWN salon's folder, and skips posts with nothing to copy", async () => {
    const { svc, rows, calls } = world(true);
    expect(await svc.archiveMissing()).toEqual({ posts: 2, copied: 2 });
    expect(calls.sort()).toEqual(['A:f-A:https://m/x.jpg', 'B:f-B:https://m/y.jpg']);
    expect(rows.find((r) => r.id === 'a1')!.driveFolderUrl).toBe('https://drive/f-A');
    expect(rows.find((r) => r.id === 'b1')!.driveFolderUrl).toBe('https://drive/f-B');
    expect(rows.find((r) => r.id === 'a2')!.driveFolderUrl).toBeNull();
    // A second pass has nothing left.
    expect(await svc.archiveMissing()).toEqual({ posts: 0, copied: 0 });
  });

  it('does nothing while Drive is still down', async () => {
    const { svc, calls } = world(false);
    expect(await svc.archiveMissing()).toEqual({ posts: 0, copied: 0 });
    expect(calls).toEqual([]);
  });
});

describe('a background copy never pulls a heavy file into memory', () => {
  const stream = (chunks: number[]) => new ReadableStream<Uint8Array>({
    start(c) { for (const n of chunks) c.enqueue(new Uint8Array(n)); c.close(); },
  });
  it('caps at 40 MB unless told otherwise, and never above 200', () => {
    delete process.env.DRIVE_MIRROR_MAX_MB;
    expect(mirrorCapBytes()).toBe(40 * 1048576);
    process.env.DRIVE_MIRROR_MAX_MB = '9999';
    expect(mirrorCapBytes()).toBe(200 * 1048576);
    delete process.env.DRIVE_MIRROR_MAX_MB;
  });
  it('reads a small body whole', async () => {
    expect((await readCapped({ body: stream([10, 20]), arrayBuffer: async () => new ArrayBuffer(0) }, 100)).length).toBe(30);
  });
  it('gives up as soon as the body passes the cap', async () => {
    await expect(readCapped({ body: stream([60, 60, 60]), arrayBuffer: async () => new ArrayBuffer(0) }, 100)).rejects.toThrow(/too heavy/);
  });
  it('refuses on the declared size without reading a byte', async () => {
    const svc = new GoogleDriveService({} as never, { get: async () => 'tok' } as never);
    let read = false;
    const real = global.fetch;
    global.fetch = (async () => ({
      ok: true, headers: { get: (k: string) => (k === 'content-length' ? String(300 * 1048576) : 'video/mp4') },
      body: { cancel: async () => undefined }, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); },
    })) as never;
    try {
      await expect(svc.mirrorFromUrl('A', 'https://m/x.mp4', 'x.mp4', 'video')).rejects.toThrow(/too heavy.*300 MB/);
      expect(read).toBe(false);
    } finally { global.fetch = real; }
  });
});
