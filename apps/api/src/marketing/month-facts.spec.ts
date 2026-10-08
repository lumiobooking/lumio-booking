/**
 * The month's content numbers come from stored posts and follow rules a
 * client would expect: the salon's calendar month, "—" for what nobody
 * measured, an arrow only when there is something to compare with, and a
 * month still running compared to the same days of the month before.
 */
import { monthFacts, rankPosts, delta, prevMonthKey, daysInMonth } from './month-facts';
import type { StoredPost } from './social-posts.service';
import { postRowFrom, postRowsFrom, mergeReading, interactionsOf, lumioPostRow, normalizeType } from './social-posts';

let n = 0;
function post(over: Partial<StoredPost> & { day: string }): StoredPost {
  n += 1;
  const { day, ...rest } = over;
  return {
    id: `p${n}`, platform: 'facebook', externalId: `x${n}`, publishedAt: new Date(`${day}T12:00:00Z`), publishedDay: day, periodMonth: day.slice(0, 7),
    type: 'post', permalink: null, thumbnailUrl: null, caption: null, publishedVia: 'platform', metricsAt: null,
    views: null, reach: null, likes: null, comments: null, shares: null, saves: null, interactions: null,
    ...rest,
  };
}

describe('month facts: posts, interactions, top 5', () => {
  it('counts every platform, sums only what was measured, ranks by interactions then views', () => {
    const cur = [
      post({ day: '2026-09-02', platform: 'facebook', interactions: 40, views: 900, likes: 30, comments: 10 }),
      post({ day: '2026-09-10', platform: 'instagram', type: 'reel', interactions: 120, views: 5000 }),
      post({ day: '2026-09-11', platform: 'instagram', type: 'photo', interactions: 120, views: 7000 }),
      post({ day: '2026-09-15', platform: 'tiktok', type: 'video', interactions: 5, views: 300, publishedVia: 'lumio' }),
      post({ day: '2026-09-20', platform: 'facebook' }), // never measured
      post({ day: '2026-09-21', platform: 'facebook', interactions: 1 }),
      post({ day: '2026-09-22', platform: 'facebook', interactions: 2 }),
    ];
    const prev = [post({ day: '2026-08-05', interactions: 100, views: 1000 }), post({ day: '2026-08-25', interactions: 50 })];
    const f = monthFacts('2026-09', cur, prev, '2026-10-08');
    expect(f.state).toBe('closed');
    expect(f.posts.total).toBe(7);
    expect(f.posts.byPlatform.map((b) => [b.platform, b.posts, b.viaLumio])).toEqual([['facebook', 4, 0], ['instagram', 2, 0], ['tiktok', 1, 1]]);
    expect(f.posts.byPlatform[1].byType).toEqual({ reel: 1, photo: 1 });
    expect(f.interactions.total).toBe(288);
    expect(f.views.total).toBe(13200);
    expect(f.top.map((t) => t.views)).toEqual([7000, 5000, 900, 300, null]); // tie on 120 → more views first; 5 max
    expect(f.top[4].interactions).toBe(2);
    expect(f.posts.vsPrev).toEqual({ value: 7, prev: 2, pct: 250 });
    expect(f.interactions.vsPrev.pct).toBe(92); // 288 vs 150
    expect(f.notes).toEqual(['unmeasured:1']);
  });

  it('a running month is compared to the same days of last month, and says so', () => {
    const cur = [post({ day: '2026-10-03', interactions: 10 }), post({ day: '2026-10-07', interactions: 10 })];
    const prev = [post({ day: '2026-09-02', interactions: 5 }), post({ day: '2026-09-05', interactions: 5 }), post({ day: '2026-09-20', interactions: 500 }), post({ day: '2026-09-28', interactions: 500 })];
    const f = monthFacts('2026-10', cur, prev, '2026-10-08');
    expect(f.state).toBe('to-date');
    expect(f.daysCovered).toBe(8);
    expect(f.posts.vsPrev).toEqual({ value: 2, prev: 2, pct: 0 });
    expect(f.interactions.vsPrev).toEqual({ value: 20, prev: 10, pct: 100 }); // not −98% against the whole of September
  });

  it('nothing measured → null, never 0; nothing to compare → no arrow', () => {
    const f = monthFacts('2026-09', [post({ day: '2026-09-01' }), post({ day: '2026-09-02' })], [], '2026-10-08');
    expect(f.interactions.total).toBeNull();
    expect(f.views.total).toBeNull();
    expect(f.top).toEqual([]);
    expect(f.notes).toEqual(['no-metrics']);
    expect(f.posts.vsPrev).toEqual({ value: 2, prev: 0, pct: null });
    expect(f.interactions.vsPrev).toEqual({ value: null, prev: null, pct: null });
    const empty = monthFacts('2026-09', [], [], '2026-10-08');
    expect(empty.posts.total).toBe(0);
    expect(empty.posts.vsPrev.pct).toBeNull();
  });

  it('helpers', () => {
    expect(delta(10, 0)).toEqual({ value: 10, prev: 0, pct: null });
    expect(delta(null, 5)).toEqual({ value: null, prev: 5, pct: null });
    expect(prevMonthKey('2026-01')).toBe('2025-12');
    expect(daysInMonth('2026-02')).toBe(28);
    expect(rankPosts([post({ day: '2026-09-01' })])).toEqual([]);
  });
});

describe('a network reading becomes a post row', () => {
  it('month and day follow the salon clock, not UTC', () => {
    // 8 PM on Sept 30 in Alberta = 02:00 UTC Oct 1.
    const r = postRowFrom('facebook', { id: '1_2', timestamp: '2026-10-01T02:00:00+0000', type: 'post', likes: 3, comments: 1 }, 'America/Edmonton')!;
    expect(r.publishedDay).toBe('2026-09-30');
    expect(r.periodMonth).toBe('2026-09');
    expect(r.interactions).toBe(4);
    expect(r.shares).toBeNull();
    expect(postRowFrom('facebook', { id: '1_2', timestamp: '2026-10-01T02:00:00+0000' }, null)!.periodMonth).toBe('2026-10');
  });
  it('drops posts without an id or a readable time, dedupes, normalises type, keeps only https links', () => {
    const rows = postRowsFrom('instagram', [
      { id: 'a', timestamp: '2026-09-03T10:00:00+0000', type: 'VIDEO', permalink: 'javascript:alert(1)', thumbnail: 'https://cdn/x.jpg', caption: '  hello\n world  ' },
      { id: 'a', timestamp: '2026-09-03T10:00:00+0000' },
      { id: '', timestamp: '2026-09-03T10:00:00+0000' },
      { id: 'b', timestamp: 'not a date' },
      { id: 'c', timestamp: '2026-09-04T10:00:00+0000', type: 'CAROUSEL_ALBUM', interactions: 9 },
    ], 'UTC');
    expect(rows.map((r) => r.externalId)).toEqual(['a', 'c']);
    expect(rows[0].type).toBe('reel');
    expect(rows[0].permalink).toBeNull();
    expect(rows[0].thumbnailUrl).toBe('https://cdn/x.jpg');
    expect(rows[0].caption).toBe('hello world');
    expect(rows[0].interactions).toBeNull();
    expect(rows[1].type).toBe('carousel');
    expect(rows[1].interactions).toBe(9); // the connector's total when nothing to add up
    expect(normalizeType('tiktok', null)).toBe('video');
    expect(normalizeType('facebook', 'video')).toBe('video');
  });
  it('a fresh reading never blanks a known number; descriptive fields only fill gaps', () => {
    const stored = { views: 100, reach: 50, likes: 5, comments: 1, shares: null, saves: null, interactions: 6, caption: 'old', permalink: null, thumbnailUrl: null, type: 'post' };
    const fresh = postRowFrom('facebook', { id: 'x', timestamp: '2026-09-03T10:00:00Z', type: 'reel', views: null, likes: 7, comments: 1, permalink: 'https://fb.com/x', caption: 'new' }, 'UTC')!;
    expect(mergeReading(stored, fresh)).toEqual({ likes: 7, interactions: 8, permalink: 'https://fb.com/x', type: 'reel' });
    expect(mergeReading({ ...stored, likes: 7, interactions: 8, permalink: 'https://fb.com/x', type: 'reel' }, fresh)).toBeNull();
    expect(interactionsOf({})).toBeNull();
    expect(interactionsOf({ likes: 2, saves: 3 })).toBe(5);
  });
  it('a post Lumio published becomes a row too; google is not a social post', () => {
    const r = lumioPostRow({ channel: 'instagram', id: '17890', url: 'https://www.instagram.com/p/abc/', postedAt: new Date('2026-09-30T23:30:00Z'), caption: 'Hi', tz: 'Asia/Ho_Chi_Minh' })!;
    expect(r.periodMonth).toBe('2026-10'); // 06:30 Oct 1 in Vietnam
    expect(r.permalink).toBe('https://www.instagram.com/p/abc/');
    expect(lumioPostRow({ channel: 'google', id: '1', postedAt: new Date() })).toBeNull();
    expect(lumioPostRow({ channel: 'facebook', id: null, postedAt: new Date() })).toBeNull();
  });
});
