import { SocialPublishService } from './social-publish.service';
import type { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * One salon must never publish to another salon's Facebook Page.
 *
 * Every other cross-tenant leak in this product is a leak of information: bad,
 * fixable, private. This one is different. A post sent to the wrong Page is
 * PUBLIC and it is IMMEDIATE — it appears under a stranger's brand, in front of
 * their followers, before anyone at Lumio knows. There is no rolling that back.
 *
 * So the rule is stricter than "queries carry a tenantId": the Page a post goes
 * to must be looked up FROM the caller's tenant, never taken from the post row,
 * never taken from a request parameter. These tests record every query the
 * service makes and assert exactly that.
 */

type Query = { model: string; op: string; args: Record<string, unknown> };

const PAGE = {
  pageId: 'PAGE_A', igId: 'IG_A', igUsername: 'a', pageName: 'Salon A',
  enabled: true, pageToken: 'tok', createdAt: new Date(),
};

function recordingPrisma(queries: Query[], overrides: Record<string, unknown> = {}) {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => (args: Record<string, unknown> = {}) => {
        queries.push({ model: name, op, args });
        if (op === 'findMany') return Promise.resolve((overrides[`${name}.findMany`] as unknown[]) ?? []);
        if (op === 'findFirst') {
          if (`${name}.findFirst` in overrides) return Promise.resolve(overrides[`${name}.findFirst`]);
          return Promise.resolve(name === 'messengerPage' ? PAGE : null);
        }
        if (op === 'updateMany') return Promise.resolve({ count: 1 });
        if (op === 'create') return Promise.resolve({ id: 'new1' });
        return Promise.resolve(null);
      },
    });
  return new Proxy({}, { get: (_t, name: string) => model(name) }) as never;
}

const svc = (q: Query[], o: Record<string, unknown> = {}) => new SocialPublishService(recordingPrisma(q, o));
const user = (tenantId: string): AuthenticatedUser =>
  ({ userId: 'u1', tenantId, role: 'SALON_ADMIN', email: 'a@b.c' } as unknown as AuthenticatedUser);

/** Every `where` clause in the args, however deeply nested. */
function wheres(args: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'where' && val && typeof val === 'object') out.push(val as Record<string, unknown>);
      walk(val);
    }
  };
  walk(args);
  return out;
}

const tenantScoped = (q: Query[], tenantId: string) => {
  const rows = q.filter((x) => x.model === 'scheduledPost' || x.model === 'messengerPage');
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    // updateMany/update by id still has to name the tenant somewhere in its
    // filter, or an id guessed from another salon selects a live row.
    const found = wheres(r.args).some((w) => w.tenantId === tenantId);
    expect({ model: r.model, op: r.op, scoped: found, args: r.args }).toMatchObject({ scoped: true });
  }
};

describe('every read and write names the caller’s tenant', () => {
  it('scopes the queue listing', async () => {
    const q: Query[] = [];
    await svc(q).list(user('T1'));
    tenantScoped(q, 'T1');
  });

  it('scopes creating a post', async () => {
    const q: Query[] = [];
    await svc(q).save(user('T1'), {
      channels: ['facebook'], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z', status: 'scheduled',
    });
    const created = q.find((x) => x.model === 'scheduledPost' && x.op === 'create');
    expect((created!.args.data as { tenantId: string }).tenantId).toBe('T1');
  });

  it('scopes cancelling by id, so a guessed id hits nothing', async () => {
    const q: Query[] = [];
    await svc(q).cancel(user('T1'), 'someone-elses-post');
    tenantScoped(q, 'T1');
  });

  it('refuses to publish a post id that does not belong to the caller', async () => {
    const q: Query[] = [];
    await expect(svc(q, { 'scheduledPost.findFirst': null }).publishNow(user('T2'), 'post-of-T1'))
      .rejects.toThrow(/Không tìm thấy/);
    tenantScoped(q, 'T2');
  });
});

describe('the Page is resolved from the tenant, never from the request', () => {
  it('looks the page up by tenantId when listing', async () => {
    const q: Query[] = [];
    await svc(q).list(user('T9'));
    const page = q.find((x) => x.model === 'messengerPage');
    expect((page!.args.where as { tenantId: string }).tenantId).toBe('T9');
  });

  it('never reads a page id or token off the post row', async () => {
    // If the token or page id were stored on the queue row, a row written under
    // one tenant and later read under another would carry a live token with it.
    const src = require('fs').readFileSync(`${__dirname}/social-publish.service.ts`, 'utf8') as string;
    expect(src).not.toMatch(/row\.(pageId|pageToken|igId)/);
    expect(src).not.toMatch(/body\.(pageId|pageToken|igId)/);
  });

  it('does not persist the page token onto the post', async () => {
    const q: Query[] = [];
    await svc(q).save(user('T1'), {
      channels: ['facebook'], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z', status: 'scheduled',
    });
    const data = JSON.stringify(q.find((x) => x.op === 'create')!.args.data);
    expect(data).not.toContain('tok');
    expect(data).not.toContain('pageToken');
  });
});

describe('what the salon is stopped from queueing at all', () => {
  it('rejects an empty post', async () => {
    await expect(svc([]).save(user('T1'), { channels: ['facebook'], message: '  ', scheduledAt: '2026-09-05T09:00:00Z' }))
      .rejects.toThrow(/chưa có nội dung/);
  });

  it('rejects a post with no time', async () => {
    await expect(svc([]).save(user('T1'), { channels: ['facebook'], message: 'hi', scheduledAt: 'not-a-date' }))
      .rejects.toThrow(/thời gian/);
  });

  it('rejects a post aimed nowhere', async () => {
    await expect(svc([]).save(user('T1'), { channels: [], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z' }))
      .rejects.toThrow(/ít nhất một nơi/);
  });

  it('refuses to schedule an Instagram post with no image, at write time', async () => {
    // The person who wrote it is still looking at the screen. Accepting it and
    // failing at 9am on Friday tells them nothing they can act on.
    await expect(svc([]).save(user('T1'), {
      channels: ['instagram'], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z', status: 'scheduled',
    })).rejects.toThrow(/ảnh hoặc video/);
  });

  it('lets the same post be SAVED as a draft, so work in progress is never lost', async () => {
    const q: Query[] = [];
    await expect(svc(q).save(user('T1'), {
      channels: ['instagram'], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z', status: 'draft',
    })).resolves.toMatchObject({ ok: true });
  });

  it('refuses to edit a post that has already gone out', async () => {
    await expect(svc([], { 'scheduledPost.findFirst': { id: 'p1', status: 'posted' } }).save(user('T1'), {
      id: 'p1', channels: ['facebook'], message: 'hi', scheduledAt: '2026-09-05T09:00:00Z',
    })).rejects.toThrow(/đã đăng rồi/);
  });
});

describe('"Post now" works on the rows that most need it', () => {
  /**
   * The button was a lie on exactly the posts a person presses it for.
   *
   * A post that failed three times is past MAX_ATTEMPTS; a cancelled one was not
   * in the claim list. Both returned "Bài đang được đăng ở tiến trình khác" — a
   * message about a race that was not happening — while the salon looked at a
   * connection that had just been fixed.
   */
  const rowOf = (status: string, attempts = 3) => ({
    'scheduledPost.findFirst': {
      id: 'p1', tenantId: 'T1', status, attempts, message: 'hi',
      channels: ['facebook'], media: [], imageUrl: null,
      scheduledAt: new Date(), lastError: 'old (#200) error', results: [],
      postedAt: null, createdByName: null, ideaId: null,
    },
  });

  it.each(['failed', 'cancelled', 'expired', 'scheduled', 'draft'])(
    'clears the wreckage of earlier attempts on a %s post', async (status) => {
      const q: Query[] = [];
      await svc(q, rowOf(status)).publishNow(user('T1'), 'p1').catch(() => undefined);
      const reset = q.find((x) => x.op === 'update'
        && (x.args.data as { attempts?: number })?.attempts === 0);
      expect(reset).toBeTruthy();
      const data = reset!.args.data as { status: string; lastError: string | null };
      expect(data.status).toBe('scheduled');
      // The old error belongs to a connection that has since been fixed.
      expect(data.lastError).toBeNull();
    },
  );

  it('still refuses a post that has already gone out', async () => {
    await expect(svc([], rowOf('posted')).publishNow(user('T1'), 'p1'))
      .rejects.toThrow(/đã đăng rồi/);
  });

  it('refuses one that is mid-flight, and says so rather than blaming a race', async () => {
    await expect(svc([], rowOf('publishing')).publishNow(user('T1'), 'p1'))
      .rejects.toThrow(/đang được đăng, chờ/);
  });

  it('never resets a post belonging to another tenant', async () => {
    const q: Query[] = [];
    await expect(svc(q, { 'scheduledPost.findFirst': null }).publishNow(user('T2'), 'p1'))
      .rejects.toThrow(/Không tìm thấy/);
    expect(q.filter((x) => x.op === 'update')).toHaveLength(0);
  });
});
