/**
 * The social_posts bookkeeping is tenant-scoped end to end: a post is found
 * by (tenantId, platform, externalId), every row is created under the tenant
 * that synced it, and one tenant's month never includes another's posts.
 */
import { SocialPostsService } from './social-posts.service';

type Row = Record<string, any>;

function fakeDb() {
  const posts: Row[] = [];
  const metrics: Row[] = [];
  let seq = 0;
  const match = (r: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(r[k]);
      if (v === null) return r[k] == null;
      return r[k] === v;
    });
  const prisma: any = {
    tenant: { findUnique: async ({ where }: Row) => ({ timezone: where.id === 't1' ? 'America/Chicago' : 'Asia/Ho_Chi_Minh' }) },
    socialPost: {
      findMany: async ({ where }: Row) => posts.filter((r) => match(r, where)),
      create: async ({ data }: Row) => { const r = { id: `sp${++seq}`, metricsAt: null, deletedAt: null, ...data }; posts.push(r); return r; },
      update: async ({ where, data }: Row) => { const r = posts.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
      updateMany: async ({ where, data }: Row) => { let c = 0; for (const r of posts) if (match(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
      count: async ({ where }: Row) => posts.filter((r) => match(r, where)).length,
    },
    socialPostMetric: { create: async ({ data }: Row) => { metrics.push(data); return data; }, findMany: async () => [], update: async () => ({}), updateMany: async () => ({}), count: async () => 0 },
  };
  return { prisma, posts, metrics };
}

const reading = (id: string, extra: Row = {}) => ({ id, timestamp: '2026-09-10T15:00:00+0000', type: 'post', likes: 2, comments: 1, ...extra });

describe('social posts service', () => {
  it('creates, then updates and appends a measurement, under the syncing tenant only', async () => {
    const { prisma, posts, metrics } = fakeDb();
    const svc = new SocialPostsService(prisma);
    const first = await svc.record('t1', 'facebook', [reading('a'), reading('b', { likes: null, comments: null })]);
    expect(first).toEqual({ platform: 'facebook', seen: 2, created: 2, updated: 0, measured: 1 });
    expect(posts.every((p) => p.tenantId === 't1')).toBe(true);
    expect(posts[0].periodMonth).toBe('2026-09');
    expect(metrics).toHaveLength(1);

    const again = await svc.record('t1', 'facebook', [reading('a', { likes: 9, views: 100 })]);
    expect(again.created).toBe(0);
    expect(again.updated).toBe(1);
    expect(posts[0].likes).toBe(9);
    expect(posts[0].interactions).toBe(10);
    expect(metrics).toHaveLength(2);
    expect(metrics[1].tenantId).toBe('t1');
  });

  it('the same network id under another tenant is a different post', async () => {
    const { prisma, posts } = fakeDb();
    const svc = new SocialPostsService(prisma);
    await svc.record('t1', 'facebook', [reading('same')]);
    await svc.record('t2', 'facebook', [reading('same', { likes: 50 })]);
    expect(posts).toHaveLength(2);
    expect(posts[0].likes).toBe(2);
    expect(posts[1].tenantId).toBe('t2');
    expect(await svc.postsForMonth('t1', '2026-09')).toHaveLength(1);
    expect((await svc.postsForMonth('t2', '2026-09'))[0].likes).toBe(50);
    expect(await svc.postsForMonth('t3', '2026-09')).toEqual([]);
  });

  it('a Lumio publish is recorded at once and later claimed by the sync without a duplicate', async () => {
    const { prisma, posts } = fakeDb();
    const svc = new SocialPostsService(prisma);
    await svc.recordLumio('t1', [
      { channel: 'facebook', id: '111_222', url: 'https://fb.com/111_222' },
      { channel: 'instagram', id: null, error: 'failed' },
      { channel: 'google', id: 'g1' },
    ], new Date('2026-09-10T15:00:00Z'), 'Caption', 'https://cdn/x.jpg', 'sched1');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ tenantId: 't1', platform: 'facebook', externalId: '111_222', publishedVia: 'lumio', scheduledPostId: 'sched1', caption: 'Caption' });
    const r = await svc.record('t1', 'facebook', [reading('111_222', { likes: 4 })]);
    expect(r.created).toBe(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].publishedVia).toBe('lumio');
    expect(posts[0].likes).toBe(4);
  });

  it('backfills a stored month from social_insights.raw once', async () => {
    const { prisma, posts } = fakeDb();
    const svc = new SocialPostsService(prisma);
    const n = await svc.backfillFromInsights('t1', '2026-08', [
      { platform: 'instagram', raw: { posts: [{ id: 'i1', timestamp: '2026-08-02T10:00:00+0000', type: 'reel', likes: 1, comments: 0 }] } },
      { platform: 'gbp', raw: { posts: [{ id: 'x', timestamp: '2026-08-02T10:00:00+0000' }] } },
    ], 'UTC');
    expect(n).toBe(1);
    expect(posts[0]).toMatchObject({ tenantId: 't1', platform: 'instagram', periodMonth: '2026-08', type: 'reel' });
  });
});
