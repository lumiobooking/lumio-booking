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
