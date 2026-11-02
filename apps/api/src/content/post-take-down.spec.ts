/**
 * "Khi nhân viên đăng bài cho khách bị sai có thể xoá từ hệ thống được không"
 * (2 Nov 2026): a published post is taken DOWN from Facebook / Instagram /
 * Google from Lumio — with the salon's own token, never another salon's —
 * and the record stays, marked removed. TikTok cannot be deleted by API.
 */
import { SocialPublishService } from './social-publish.service';
import type { AuthenticatedUser } from '../common/tenant/tenant-context';
import type { MediaStore } from './media-store';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const POSTED = {
  id: 'p1', tenantId: 't1', status: 'posted', channels: ['facebook', 'instagram', 'google', 'tiktok'], message: 'Halloween look', media: [], imageUrl: null,
  scheduledAt: new Date(), attempts: 1, lastError: null, postedAt: new Date(), createdByName: null, ideaId: null,
  results: [
    { channel: 'facebook', id: '111_222', url: 'https://www.facebook.com/111_222', error: null },
    { channel: 'instagram', id: '17890000000000001', url: 'https://www.instagram.com/p/x', error: null },
    { channel: 'google', id: 'accounts/9/locations/8/localPosts/7', url: 'https://maps', error: null },
    { channel: 'tiktok', id: 'v_pub_1', url: 'https://www.tiktok.com/@a', error: null },
  ],
};

function world(o: { pageTokenFor?: Record<string, string>; graph?: (url: string) => { status: number; json: Row } } = {}) {
  const q: { model: string; op: string; args: Row }[] = [];
  const rows: Record<string, Row[]> = {
    scheduledPost: [{ ...POSTED, results: POSTED.results.map((r) => ({ ...r })) }, { ...POSTED, id: 'p2', tenantId: 't2' }],
    messengerPage: [{ tenantId: 't1', pageId: '111', igId: 'IG1', pageToken: 'TOKEN_T1', enabled: true, createdAt: new Date() }, { tenantId: 't2', pageId: '999', pageToken: 'TOKEN_T2', enabled: true, createdAt: new Date() }],
  };
  const match = (r: Row, w: Row = {}) => Object.entries(w).every(([k, v]) => r[k] === v);
  const model = (name: string) => new Proxy({}, {
    get: (_t, op: string) => async (args: Row = {}) => {
      q.push({ model: name, op, args });
      const list = rows[name] ?? [];
      if (op === 'findFirst') return list.find((r) => match(r, args.where)) ?? null;
      if (op === 'findMany') return list.filter((r) => match(r, args.where));
      if (op === 'updateMany') { let n = 0; for (const r of list) if (match(r, args.where)) { Object.assign(r, args.data); n++; } return { count: n }; }
      if (op === 'create') return { id: 'new' };
      return null;
    },
  });
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) });
  const deleted: string[] = [];
  const google = { deleteLocalPost: jest.fn(async (tenantId: string, name: string) => { deleted.push(`${tenantId}:${name}`); }) };
  const uploads: MediaStore = { publicBase: async () => null, deletePaths: async () => ({ deleted: 0, failed: 0 }) };
  const svc = new SocialPublishService(prisma as never, uploads, undefined, google as never);
  const calls: string[] = [];
  const fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((async (url: string, init: Row) => {
    calls.push(`${init?.method} ${url}`);
    const g = o.graph?.(url) ?? { status: 200, json: { success: true } };
    return { ok: g.status < 300, status: g.status, json: async () => g.json, text: async () => JSON.stringify(g.json) };
  }) as never);
  return { svc, rows, q, calls, google, deleted, fetchSpy };
}
const as = (tenantId: string, role = 'SALON_ADMIN', extra: Row = {}) => ({ userId: 'u1', tenantId, role, email: 'owner@x.com', ...extra }) as unknown as AuthenticatedUser;

describe('Gỡ khỏi trang', () => {
  let w: ReturnType<typeof world>;
  afterEach(() => w?.fetchSpy.mockRestore());

  it('takes it down from Facebook, Instagram and Google with the salon’s own token; TikTok says why not', async () => {
    w = world();
    const r = await w.svc.takeDown(as('t1'), 'p1');
    expect(r.removed.sort()).toEqual(['facebook', 'google', 'instagram']);
    expect(r.failed).toEqual([expect.objectContaining({ channel: 'tiktok', error: expect.stringMatching(/TikTok/) })]);
    expect(w.calls).toEqual([
      expect.stringMatching(/^DELETE https:\/\/graph\.facebook\.com\/v[\d.]+\/111_222\?access_token=TOKEN_T1$/),
      expect.stringMatching(/^DELETE https:\/\/graph\.facebook\.com\/v[\d.]+\/17890000000000001\?access_token=TOKEN_T1$/),
    ]);
    expect(w.deleted).toEqual(['t1:accounts/9/locations/8/localPosts/7']);
    // the record stays — each network marked removed, by whom
    const row = w.rows.scheduledPost.find((x) => x.id === 'p1')!;
    expect(row.status).toBe('posted');
    expect(row.results.filter((x: Row) => x.removedAt).map((x: Row) => x.channel).sort()).toEqual(['facebook', 'google', 'instagram']);
    expect(row.results.find((x: Row) => x.channel === 'facebook').removedBy).toBe('owner@x.com');
    expect(row.results.find((x: Row) => x.channel === 'tiktok').removeError).toMatch(/TikTok/);
    // the week's record knows, and the audit says who
    expect(w.q.some((x) => x.model === 'socialPost' && x.op === 'updateMany' && x.args.where.tenantId === 't1' && x.args.where.externalId === '111_222' && x.args.data.deletedAt instanceof Date)).toBe(true);
    expect(w.q.some((x) => x.model === 'auditLog' && x.args.data.action === 'content.post_taken_down' && x.args.data.tenantId === 't1')).toBe(true);
  });

  it('only the channels chosen; a second press does not ask the network again', async () => {
    w = world();
    await w.svc.takeDown(as('t1'), 'p1', { channels: ['facebook'] });
    expect(w.calls).toHaveLength(1);
    await expect(w.svc.takeDown(as('t1'), 'p1', { channels: ['facebook'] })).rejects.toThrow(/không còn trên kênh nào/);
    expect(w.calls).toHaveLength(1);
  });

  it('already gone on Facebook counts as taken down; any other refusal is kept with Meta’s words', async () => {
    w = world({ graph: (u) => (u.includes('111_222') ? { status: 400, json: { error: { code: 100, error_subcode: 33, message: 'Unsupported delete request. Object does not exist' } } } : { status: 400, json: { error: { code: 10, message: 'Ad posts cannot be deleted' } } }) });
    const r = await w.svc.takeDown(as('t1'), 'p1', { channels: ['facebook', 'instagram'] });
    expect(r.removed).toEqual(['facebook']);
    expect(r.failed[0]).toMatchObject({ channel: 'instagram' });
  });

  it('another salon’s post is not found — and nothing is ever deleted with another salon’s token', async () => {
    w = world();
    await expect(w.svc.takeDown(as('t1'), 'p2')).rejects.toThrow(/Không tìm thấy/);
    expect(w.calls).toHaveLength(0);
    const from = w.q.length;
    await w.svc.takeDown(as('t2'), 'p2', { channels: ['facebook'] });
    expect(w.calls.length).toBe(1);
    expect(w.calls.every((c) => c.endsWith('access_token=TOKEN_T2'))).toBe(true);
    for (const x of w.q.slice(from).filter((y) => y.model === 'scheduledPost' || y.model === 'messengerPage')) expect(x.args.where.tenantId).toBe('t2');
  });

  it('a technician / desk login cannot; the owner and the Lumio team can', async () => {
    w = world();
    await expect(w.svc.takeDown(as('t1', 'STAFF'), 'p1')).rejects.toThrow(/Chỉ chủ tiệm hoặc team Lumio/);
    expect(w.calls).toHaveLength(0);
    const r = await w.svc.takeDown(as('t1', 'STAFF', { supportSession: true }), 'p1', { channels: ['facebook'] });
    expect(r.removed).toEqual(['facebook']);
  });
});
