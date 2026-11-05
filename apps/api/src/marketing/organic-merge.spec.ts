/**
 * A month's social numbers do not flicker: a field the platform did not
 * answer keeps what was read before; a real answer (0 too) wins; views
 * measured two different ways are never compared.
 */
import { mergeOrganic, sameViewsMeasure } from './organic-merge';
import { TikTokOrganicConnector } from './connectors/tiktok.connector';

describe('mergeOrganic', () => {
  const prev = { followers: 81, reach: null, views: 15_000, engagement: 11, postsCount: 4, raw: { viewsSource: 'page', posts: [{ id: 'p1' }], series: [{ date: '2026-10-01', value: 1 }] } };

  it('a blank answer keeps the earlier value; a new answer replaces it', () => {
    const { row, kept } = mergeOrganic(prev, { followers: 82, reach: null, views: null, engagement: null, postsCount: null, raw: { posts: [], series: [] } });
    expect(row).toMatchObject({ followers: 82, views: 15_000, engagement: 11, postsCount: 4 });
    expect(kept).toEqual(['views', 'engagement', 'postsCount']);
    expect(row.raw).toMatchObject({ viewsSource: 'page', posts: [{ id: 'p1' }], series: [{ date: '2026-10-01', value: 1 }], kept });
  });

  it('zero is an answer: a quiet month prints 0, not last read', () => {
    const { row, kept } = mergeOrganic(prev, { followers: 81, views: 0, engagement: 0, postsCount: 0, raw: { viewsSource: 'posts', posts: [] } });
    expect(row).toMatchObject({ views: 0, engagement: 0, postsCount: 0 });
    expect(kept).toEqual([]);
    expect((row.raw as any).posts).toEqual([]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((row.raw as any).viewsSource).toBe('posts'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('a hand-typed number survives a sync that could not read it', () => {
    const typed = { views: 341, followers: 4, source: 'manual', raw: { manual: true } };
    expect(mergeOrganic(typed, { followers: 5, views: null, raw: {} }).row).toMatchObject({ followers: 5, views: 341 });
  });

  it('first read of a month: nothing to keep', () => {
    expect(mergeOrganic(null, { views: null, raw: {} })).toEqual({ row: { views: null, raw: {} }, kept: [] });
  });
});

describe('sameViewsMeasure', () => {
  it('compares page total with page total, posts with posts, old with old', () => {
    expect(sameViewsMeasure({ raw: { viewsSource: 'page' } }, { raw: { viewsSource: 'page' } })).toBe(true);
    expect(sameViewsMeasure({ raw: { viewsSource: 'page' } }, { raw: { viewsSource: 'posts' } })).toBe(false);
    expect(sameViewsMeasure({ raw: { viewsSource: 'page' } }, { raw: {} })).toBe(false);
    expect(sameViewsMeasure({ raw: {} }, { raw: null })).toBe(true);
  });
});

describe('TikTok connector', () => {
  const realFetch = (globalThis as any).fetch; // eslint-disable-line @typescript-eslint/no-explicit-any
  afterEach(() => { (globalThis as any).fetch = realFetch; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const reply = (body: unknown, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(body), json: async () => body });

  it('a rotated refresh token is handed back; without stats permission the name and videos still come', async () => {
    const calls: string[] = [];
    const fetchMock = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/oauth/token/')) return reply({ access_token: 'AT', refresh_token: 'RT-new' });
      if (url.includes('follower_count')) return reply({ error: { code: 'scope_not_authorized', message: 'no stats' } }, 401);
      if (url.includes('/user/info/')) return reply({ data: { user: { open_id: 'o', display_name: 'zbnails' } }, error: { code: 'ok' } });
      return reply({ data: { videos: [{ id: 'v1', create_time: Date.UTC(2026, 9, 10) / 1000, view_count: 300, like_count: 10 }], has_more: false }, error: { code: 'ok' } });
    });
    (globalThis as any).fetch = fetchMock; // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.resetModules();
    const { TikTokOrganicConnector: C } = await import('./connectors/tiktok.connector');
    const creds: Record<string, unknown> = { clientId: 'k', clientSecret: 's', refreshToken: 'RT-old', timezone: 'UTC' };
    const r = await new C().fetchOrganic(creds as never, '2026-10');
    expect(creds.rotatedRefreshToken).toBe('RT-new');
    expect(r.tiktok).toMatchObject({ accountName: '@zbnails', followers: null, views: 300, postsCount: 1 });
    expect((r.tiktok!.raw as any).viewsSource).toBe('posts'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((r.tiktok!.raw as any).ttDebug.stats).toContain('scope_not_authorized'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(TikTokOrganicConnector).toBeDefined();
  });

  it('a refused video list is unknown (null), not "0 videos"', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/user/info/')) return reply({ data: { user: { display_name: 'x', follower_count: 4 } }, error: { code: 'ok' } });
      return reply({ error: { code: 'scope_not_authorized', message: 'video.list' } }, 401);
    });
    (globalThis as any).fetch = fetchMock; // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.resetModules();
    const { TikTokOrganicConnector: C } = await import('./connectors/tiktok.connector');
    const r = await new C().fetchOrganic({ token: 'AT', timezone: 'UTC' } as never, '2026-10');
    expect(r.tiktok).toMatchObject({ followers: 4, views: null, postsCount: null });
    expect((r.tiktok!.raw as any).ttDebug.videoList).toContain('scope_not_authorized'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('alignWithPosts — the table and the content section say the same', () => {
  const facts = {
    posts: {
      byPlatform: [{ platform: 'facebook', views: 9_800, interactions: 24 }, { platform: 'instagram', views: 688, interactions: 22 }, { platform: 'tiktok', views: null, interactions: null }],
      prevByPlatform: [{ platform: 'facebook', views: 14_682, interactions: 12 }],
    },
  };
  it('Facebook (no page total) and refused Instagram take the posts totals; last month compares like with like', async () => {
    const { alignWithPosts } = await import('./organic-merge');
    const rows = alignWithPosts([
      { platform: 'facebook', views: 1_525, engagement: 11, viewsSource: null, vsPrev: {} },
      { platform: 'instagram', views: null, engagement: 22, igDebug: { errors: ['views(total): (#10) Application does not have permission', 'total_interactions(total): (#10) …'] }, vsPrev: {} },
      { platform: 'tiktok', views: 341, engagement: 13, manual: true, vsPrev: { views: { value: 341, prev: 29, pct: 1076 } } },
    ], facts);
    expect(rows[0]).toMatchObject({ views: 9_800, viewsFrom: 'posts', engagement: 24, vsPrev: { views: { value: 9_800, prev: 14_682, pct: -33 }, engagement: { value: 24, prev: 12, pct: 100 } } });
    expect(rows[1]).toMatchObject({ views: 688, viewsFrom: 'posts', engagement: 22, engagementFrom: 'posts' });
    expect(rows[2]).toMatchObject({ views: 341, engagement: 13 }); // typed by hand: left alone
    expect((rows[2] as { viewsFrom?: string }).viewsFrom).toBeUndefined();
  });
  it('an account total the network gave stays', async () => {
    const { alignWithPosts } = await import('./organic-merge');
    const [r] = alignWithPosts([{ platform: 'instagram', views: 5_000, engagement: 40, viewsSource: 'page', engagementSource: 'page', vsPrev: {} }], facts);
    expect(r).toMatchObject({ views: 5_000, engagement: 40, viewsFrom: 'account', engagementFrom: 'account' });
  });
});

describe('post pictures', () => {
  it('a video file is never a picture; an expiring CDN picture is replaced by a fresh one', async () => {
    const { imageUrl, mergeReading } = await import('./social-posts');
    expect(imageUrl('https://lumiobooking.com/x/reel.mov')).toBeNull();
    expect(imageUrl('https://lumiobooking.com/x/a.MP4?v=1')).toBeNull();
    expect(imageUrl('https://lumiobooking.com/x/a.jpg')).toBe('https://lumiobooking.com/x/a.jpg');
    const fresh = { thumbnailUrl: 'https://scontent.xx.fbcdn.net/new.jpg', type: 'post' } as never;
    expect(mergeReading({ thumbnailUrl: 'https://lumiobooking.com/x/reel.mov' } as never, fresh)).toMatchObject({ thumbnailUrl: 'https://scontent.xx.fbcdn.net/new.jpg' });
    expect(mergeReading({ thumbnailUrl: 'https://scontent.xx.fbcdn.net/old.jpg' } as never, fresh)).toMatchObject({ thumbnailUrl: 'https://scontent.xx.fbcdn.net/new.jpg' });
    expect(mergeReading({ thumbnailUrl: 'https://lumiobooking.com/x/a.jpg' } as never, fresh)).toBeNull();
  });
});
