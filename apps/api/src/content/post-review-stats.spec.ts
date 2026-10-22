import { PostReviewService } from './post-review.service';
import { statsByPost } from './post-review';

describe('what a posted post earned, as the client sees it', () => {
  it('adds the networks up and keeps "never reported" apart from zero', () => {
    const m = statsByPost([
      { scheduledPostId: 'p1', views: 900, likes: 20, comments: 2 },
      { scheduledPostId: 'p1', views: null, reach: 300, likes: 5, comments: null },
      { scheduledPostId: 'p2', views: null, reach: null, likes: null, comments: null },
      { scheduledPostId: null, views: 5000 },
    ]);
    expect(m.get('p1')).toEqual({ views: 1200, likes: 25, comments: 2 });
    expect(m.get('p2')).toEqual({ views: null, likes: null, comments: null });
    expect(m.size).toBe(2);
  });
});

describe('the review feed carries the numbers — and only its own salon\'s', () => {
  const A = 'tenant-aaaaaaaaaa';
  const B = 'tenant-bbbbbbbbbb';
  const social = [
    { tenantId: A, scheduledPostId: 'post-1', views: 1200, reach: 800, likes: 40, comments: 3, deletedAt: null },
    // Same post id under ANOTHER salon: must never be added in.
    { tenantId: B, scheduledPostId: 'post-1', views: 99999, reach: 1, likes: 999, comments: 999, deletedAt: null },
  ];
  let socialWhere: Record<string, unknown> | null = null;
  const prisma = {
    tenant: { findUnique: async () => ({ name: 'Salon A', timezone: 'America/Chicago' }) },
    messengerPage: { findFirst: async () => null },
    scheduledPost: {
      findMany: async () => [
        { id: 'post-1', status: 'posted', postedAt: new Date(), scheduledAt: new Date(Date.now() - 86_400_000), message: 'Hi', media: [], channels: ['facebook'], results: [] },
        { id: 'post-2', status: 'scheduled', scheduledAt: new Date(Date.now() + 86_400_000), message: 'Soon', media: [], channels: ['facebook'], results: [] },
      ],
    },
    socialPost: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        socialWhere = a.where;
        const ids = ((a.where.scheduledPostId as { in: string[] }).in);
        return social.filter((r) => r.tenantId === a.where.tenantId && ids.includes(r.scheduledPostId) && r.deletedAt === null);
      },
    },
  };

  it('scopes the stats query by the tenant and asks only for posted posts', async () => {
    const svc = new PostReviewService(prisma as never);
    const feed = await svc.feed(A);
    expect(socialWhere).toMatchObject({ tenantId: A, scheduledPostId: { in: ['post-1'] }, deletedAt: null });
    const posted = feed.posts.find((p) => p.id === 'post-1');
    expect(posted?.stats).toEqual({ views: 1200, likes: 40, comments: 3 });
    expect(feed.posts.find((p) => p.id === 'post-2')?.stats).toBeNull();
  });

  it('a salon without the table on this deploy still gets its feed', async () => {
    const svc = new PostReviewService({ ...prisma, socialPost: undefined } as never);
    const feed = await svc.feed(A);
    expect(feed.posts.find((p) => p.id === 'post-1')?.stats).toBeNull();
  });
});
