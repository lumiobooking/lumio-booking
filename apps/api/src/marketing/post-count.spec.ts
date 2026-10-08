/**
 * The monthly report's post counts.
 *  - The month runs midnight-to-midnight in the SALON's timezone, not UTC.
 *  - Instagram: every page is read, and the count is taken before the 40-post
 *    display cap (it used to stop at 40 and at one page of 50).
 *  - Facebook: visitors' posts on the Page and profile/cover-photo changes are
 *    not the salon's posts.
 */
import { inWindow, isOwnFbPost, monthWindow } from './month-window';

describe('the report month in the salon\'s clock', () => {
  it('Alberta (UTC-6 in October): Oct 31 8 PM local is October; Nov 1 1 AM local is not', () => {
    const w = monthWindow('2026-10', 'America/Edmonton');
    expect(new Date(w.from).toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(new Date(w.to).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(inWindow('2026-11-01T02:00:00Z', w)).toBe(true);  // Oct 31, 8 PM in Alberta
    expect(inWindow('2026-11-01T07:00:00Z', w)).toBe(false); // Nov 1, 1 AM
    expect(inWindow('2026-10-01T03:00:00Z', w)).toBe(false); // Sep 30, 9 PM
  });
  it('December rolls into January; no timezone = UTC as before', () => {
    expect(new Date(monthWindow('2026-12', 'America/New_York').to).toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(monthWindow('2026-10', null)).toEqual({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) });
  });
  it('a post without a readable time is not counted', () => {
    expect(inWindow(undefined, monthWindow('2026-10'))).toBe(false);
  });
});

describe('what counts as the salon\'s own Facebook post', () => {
  it('own posts yes; a visitor\'s post or a new profile/cover picture no', () => {
    expect(isOwnFbPost({ from: { id: 'page1' }, message: 'Fall special' }, 'page1')).toBe(true);
    expect(isOwnFbPost({ message: 'Reel' }, 'page1')).toBe(true); // reels edge has no `from`
    expect(isOwnFbPost({ from: { id: 'someone' }, message: 'Love this salon!' }, 'page1')).toBe(false);
    expect(isOwnFbPost({ from: { id: 'page1' }, story: 'Friendly Nails updated their profile picture.' }, 'page1')).toBe(false);
    expect(isOwnFbPost({ from: { id: 'page1' }, story: 'Friendly Nails updated their cover photo.', message: 'New look!' }, 'page1')).toBe(true);
  });
});

describe('Instagram: every page read, the real count kept', () => {
  const realFetch = (globalThis as { fetch?: unknown }).fetch;
  afterAll(() => { (globalThis as { fetch?: unknown }).fetch = realFetch; });

  it('63 posts in October across two pages, plus older ones: 63, not 50', async () => {
    const oct = (i: number) => ({ id: `m${i}`, timestamp: new Date(Date.UTC(2026, 9, 31, 20) - i * 10 * 3600_000).toISOString(), media_type: 'IMAGE' });
    const page1 = Array.from({ length: 50 }, (_, i) => oct(i));
    const page2 = [...Array.from({ length: 13 }, (_, i) => oct(50 + i)), { id: 'sep', timestamp: '2026-09-20T12:00:00Z' }];
    const calls: string[] = [];
    (globalThis as { fetch?: unknown }).fetch = async (url: string) => {
      calls.push(url);
      let body: unknown = { data: [] };
      if (/\/media\?/.test(url) && !/after=/.test(url)) body = { data: page1, paging: { next: 'https://graph.facebook.com/v21.0/ig1/media?after=p2' } };
      else if (/after=p2/.test(url)) body = { data: page2, paging: { next: 'https://graph.facebook.com/v21.0/ig1/media?after=p3' } };
      else if (/\/insights\?/.test(url)) body = { data: [{ name: 'reach', values: [{ value: 10 }] }] };
      return { status: 200, text: async () => JSON.stringify(body) };
    };
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MetaSocialConnector } = require('./connectors/meta-social.connector');
    const c = new MetaSocialConnector();
    const r = await (c as { igMediaBreakdown: (id: string, w: unknown, t: string) => Promise<{ posts: unknown[]; count: number }> })
      .igMediaBreakdown('ig1', monthWindow('2026-10', 'America/Edmonton'), 'tok');
    expect(r.count).toBe(63);
    expect(r.posts).toHaveLength(63); // every post is kept (cap is 100) — each becomes a social_posts row
    expect(calls.some((u) => /after=p3/.test(u))).toBe(false); // stopped once the month was passed
  });
});
