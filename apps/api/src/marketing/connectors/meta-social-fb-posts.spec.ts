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
