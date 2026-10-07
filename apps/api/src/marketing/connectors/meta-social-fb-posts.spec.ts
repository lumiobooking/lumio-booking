import { MetaSocialConnector } from './meta-social.connector';
import * as iface from './social-connector.interface';
import { monthWindow } from '../month-window';

/**
 * "Thống kê nội dung theo tháng đã đúng chưa?" — the Facebook post count for
 * the month a report is about. Pins the three ways it used to go wrong:
 * a Reel counted twice (as a Page post and on video_reels), a Reel placed in
 * the month it was last EDITED, and an earlier month missing posts because
 * only the newest 60 items were read.
 */
type Resp = { ok: boolean; status: number; json: any };
const ok = (json: any): Resp => ({ ok: true, status: 200, json });
const fail = (msg: string): Resp => ({ ok: false, status: 400, json: { error: { message: msg } } });

describe('Facebook posts counted for the report month', () => {
  afterEach(() => jest.restoreAllMocks());

  const run = async (route: (url: string) => Resp) => {
    jest.spyOn(iface, 'getJson').mockImplementation(async (url: string) => route(url));
    const conn = new MetaSocialConnector() as any;
    return conn.fbPostBreakdown('page1', monthWindow('2026-08'), 'tok') as Promise<{ posts: any[]; monthCount: number | null }>;
  };

  it('a Reel that is both a Page post and on video_reels counts once, with its video views', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/(published_posts|feed|posts)\?/.test(url)) return ok({ data: [
        { id: 'page1_111', message: 'Reel caption', created_time: '2026-08-05T10:00:00+0000', permalink_url: 'https://www.facebook.com/reel/900' },
        { id: 'page1_222', message: 'Photo post', created_time: '2026-08-06T10:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/222', full_picture: 'https://x/p.jpg' },
      ] });
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [
        { id: '900', description: 'Reel caption', created_time: '2026-08-05T10:00:00+0000', updated_time: '2026-08-05T10:00:00+0000', permalink_url: 'https://www.facebook.com/reel/900' },
      ] });
      if (/\/900\?fields=views/.test(url)) return ok({ views: 321 });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(2);
    const reel = out.posts.find((p) => p.type === 'reel');
    expect(reel).toMatchObject({ id: '900', views: 321, caption: 'Reel caption' });
    expect(out.posts.filter((p) => p.type === 'post')).toHaveLength(1);
  });

  it('a Reel posted in July but edited in August is not an August post', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [
        { id: '700', description: 'old', created_time: '2026-07-20T10:00:00+0000', updated_time: '2026-08-10T10:00:00+0000' },
      ] });
      if (/\/page1\//.test(url)) return ok({ data: [] });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(0);
  });

  it('asks for the month itself and follows the next pages', async () => {
    const seen: string[] = [];
    const out = await run((url) => {
      seen.push(url);
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/published_posts\?after=X/.test(url)) return ok({ data: [{ id: 'page1_2', message: 'b', created_time: '2026-08-03T10:00:00+0000' }] });
      if (/\/page1\/published_posts\?/.test(url)) return ok({
        data: [{ id: 'page1_1', message: 'a', created_time: '2026-08-02T10:00:00+0000' }],
        paging: { next: 'https://graph.facebook.com/v21.0/page1/published_posts?after=X&access_token=ptok' },
      });
      if (/\/page1\//.test(url)) return ok({ data: [] });
      return fail('unrouted');
    });
    expect(seen.some((u) => /published_posts\?.*since=\d+&until=\d+/.test(u))).toBe(true);
    expect(out.monthCount).toBe(2);
  });

  it('an edge that refuses since/until is read without them (the month filter still applies)', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/video_reels\?.*since=/.test(url)) return fail('(#100) param since is not supported');
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [
        { id: '801', description: 'aug', created_time: '2026-08-15T10:00:00+0000' },
        { id: '802', description: 'sep', created_time: '2026-09-02T10:00:00+0000' },
      ] });
      if (/\/page1\//.test(url)) return ok({ data: [] });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(1);
  });
});

describe('every post gets its views and viewers; a refused field never hides the month', () => {
  afterEach(() => jest.restoreAllMocks());
  type Resp = { ok: boolean; status: number; json: any };
  const ok = (json: any): Resp => ({ ok: true, status: 200, json });
  const fail = (msg: string): Resp => ({ ok: false, status: 400, json: { error: { message: msg } } });
  const run = async (route: (url: string) => Resp) => {
    jest.spyOn(iface, 'getJson').mockImplementation(async (url: string) => route(url));
    const conn = new MetaSocialConnector() as any;
    return conn.fbPostBreakdown('page1', monthWindow('2026-09'), 'tok') as Promise<{ posts: any[]; monthCount: number | null; error: string | null }>;
  };

  it('photo and multi-media posts read post_media_views / post_total_media_views_unique (2026 names), with the old names as fallback', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/published_posts\?/.test(url)) return ok({ data: [
        { id: 'page1_1', message: 'Tùng Cúc Trúc Mai', from: { id: 'page1' }, created_time: '2026-09-20T01:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/1' },
        { id: 'page1_2', message: 'Một gốc tùng', from: { id: 'page1' }, created_time: '2026-09-22T13:08:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/2' },
      ] });
      if (/\/page1\/(feed|posts|video_reels)\?/.test(url)) return ok({ data: [] });
      if (/\/page1_1\/insights\?metric=post_media_views/.test(url)) return ok({ data: [{ name: 'post_media_views', values: [{ value: 564 }] }, { name: 'post_total_media_views_unique', values: [{ value: 235 }] }] });
      if (/\/page1_2\/insights\?metric=post_media_views/.test(url)) return fail('(#100) Invalid metric');
      if (/\/page1_2\/insights\?metric=post_impressions/.test(url)) return ok({ data: [{ name: 'post_impressions', values: [{ value: 767 }] }, { name: 'post_impressions_unique', values: [{ value: 340 }] }] });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(2);
    expect(out.posts.find((p) => p.id === 'page1_1')).toMatchObject({ views: 564, reach: 235, type: 'post' });
    expect(out.posts.find((p) => p.id === 'page1_2')).toMatchObject({ views: 767, reach: 340 });
    expect(out.error).toBeNull();
  });

  it('a field the token may not read: the edge is re-asked without it, so the posts still count', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/published_posts\?fields=[^&]*\bfrom\b/.test(url)) return fail('(#100) Tried accessing nonexisting field (from)');
      if (/\/page1\/published_posts\?/.test(url)) return ok({ data: [
        { id: 'page1_1', message: 'A', created_time: '2026-09-02T10:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/1' },
        { id: 'page1_2', message: 'B', created_time: '2026-09-03T10:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/2' },
        { id: 'page1_3', message: 'C', created_time: '2026-09-04T10:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/3' },
      ] });
      if (/\/page1\/(feed|posts)\?/.test(url)) return fail('(#10) permission');
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [{ id: '9', description: 'reel', created_time: '2026-09-11T12:11:00+0000' }] });
      if (/\/insights\?/.test(url)) return fail('no insights');
      if (/\/9\?fields=views/.test(url)) return ok({ views: 504 });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(4);
    expect(out.error).toBeNull();
  });

  it('Reels only, every post edge refused: the count is kept but the reason is reported', async () => {
    const out = await run((url) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: 'ptok' });
      if (/\/page1\/(published_posts|feed|posts)\?/.test(url)) return fail('(#10) This endpoint requires the pages_read_user_content permission');
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [{ id: '9', description: 'reel', created_time: '2026-09-11T12:11:00+0000' }, { id: '8', description: 'reel 2', created_time: '2026-09-12T12:11:00+0000' }] });
      if (/\/insights\?/.test(url)) return fail('no insights');
      if (/\?fields=views/.test(url)) return ok({ views: 1 });
      return fail('unrouted');
    });
    expect(out.monthCount).toBe(2);
    expect(out.error).toMatch(/bài thường không đọc được/);
    expect(out.error).toMatch(/pages_read_user_content/);
  });
});

describe('two tokens: the one Meta lets read the Page wins', () => {
  afterEach(() => jest.restoreAllMocks());
  type Resp = { ok: boolean; status: number; json: any };
  const ok = (json: any): Resp => ({ ok: true, status: 200, json });
  const fail = (msg: string): Resp => ({ ok: false, status: 400, json: { error: { message: msg } } });

  it('the agency token sees only public Reels; the salon\'s own Page token reads every post — the report takes the Page token\'s answer', async () => {
    jest.spyOn(iface, 'getJson').mockImplementation(async (url: string) => {
      const own = /access_token=OWN/.test(url) || /access_token=OWNPAGE/.test(url);
      if (/\/page1\?fields=access_token/.test(url)) return own ? ok({ access_token: 'OWNPAGE' }) : ok({ id: 'page1' }); // agency: no role → no token
      if (/\/page1\/(published_posts|feed|posts)\?/.test(url)) return own
        ? ok({ data: [
          { id: 'page1_1', message: 'Photo', from: { id: 'page1' }, created_time: '2026-09-20T01:00:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/1' },
          { id: 'page1_2', message: 'Multi', from: { id: 'page1' }, created_time: '2026-09-22T13:08:00+0000', permalink_url: 'https://www.facebook.com/page1/posts/2' },
        ] })
        : ok({ data: [] }); // Meta answers EMPTY, not an error, for a Page the token has no role on
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [{ id: '9', description: 'reel', created_time: '2026-09-11T12:11:00+0000' }] });
      if (/\/insights\?/.test(url)) return fail('no insights');
      if (/\?fields=views/.test(url)) return ok({ views: 504 });
      return fail('unrouted');
    });
    const conn = new MetaSocialConnector() as any;
    const out = await conn.fbPostsWithEitherToken('page1', monthWindow('2026-09'), 'AGENCY', 'OWN');
    expect(out.monthCount).toBe(3);
    expect(out.posts.filter((p: any) => p.type === 'post')).toHaveLength(2);
  });

  it('no second token: the first answer stands', async () => {
    jest.spyOn(iface, 'getJson').mockImplementation(async (url: string) => {
      if (/\/page1\?fields=access_token/.test(url)) return ok({ id: 'page1' });
      if (/\/page1\/(published_posts|feed|posts)\?/.test(url)) return ok({ data: [] });
      if (/\/page1\/video_reels\?/.test(url)) return ok({ data: [{ id: '9', description: 'reel', created_time: '2026-09-11T12:11:00+0000' }] });
      if (/\?fields=views/.test(url)) return ok({ views: 1 });
      return fail('unrouted');
    });
    const conn = new MetaSocialConnector() as any;
    const out = await conn.fbPostsWithEitherToken('page1', monthWindow('2026-09'), 'AGENCY', undefined);
    expect(out.monthCount).toBe(1);
  });
});
