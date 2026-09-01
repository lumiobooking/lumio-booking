import {
  parseYouTube, parseInstagram, parseGoogleTrends, perDayOf, isoDurationSec, latinShare, relevant, withGrowth,
  matchService, serviceKeywords, shortCount, rankItems, diversify, overlay, overlayQueries,
  scopeOf, queriesFor, needsRefresh, type TrendItem,
} from './trend-feed';
import { bi, enOf, viOf } from '../i18n';

const NOW = new Date('2026-09-01T12:00:00Z');

describe('reading what each feed answers', () => {
  it('turns a YouTube videos.list answer into cards with a picture and a count', () => {
    const items = parseYouTube([
      { id: 'abc', snippet: { title: 'Chrome cat-eye on almond nails', publishedAt: '2026-08-30T12:00:00Z', thumbnails: { medium: { url: 'https://i.ytimg.com/m.jpg' } } }, statistics: { viewCount: '412000' }, contentDetails: { duration: 'PT42S' } },
      { id: '', snippet: { title: 'no id' } },
      { id: 'x', snippet: { title: '' } },
    ], 'nail art', NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'abc', source: 'youtube', count: 412000, durationSec: 42, thumbUrl: 'https://i.ytimg.com/m.jpg', via: 'nail art' });
    expect(items[0].url).toContain('abc');
  });

  it('turns Instagram top_media into cards, using the caption first line as the title', () => {
    const items = parseInstagram([
      { id: '1', media_type: 'IMAGE', media_url: 'https://cdn/a.jpg', permalink: 'https://instagram.com/p/a', like_count: 28400, caption: 'Burnt-orange French tips for September\n#fallnails #nails', timestamp: '2026-08-31T00:00:00Z' },
      { id: '2', media_type: 'VIDEO', thumbnail_url: 'https://cdn/t.jpg', media_url: 'https://cdn/v.mp4', permalink: 'https://instagram.com/p/b' },
      { id: '3' },
    ], 'nailart', NOW);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Burnt-orange French tips for September');
    expect(items[0].count).toBe(28400);
    // A video card shows its poster frame, not the mp4.
    expect(items[1].thumbUrl).toBe('https://cdn/t.jpg');
    expect(items[1].title).toBe('#nailart');
  });

  it('leaves a video card without a thumb rather than pointing an img at an mp4', () => {
    // Hashtag top_media has no thumbnail_url field — asking for it is a (#100) —
    // so a VIDEO row arrives with only media_url, which is a video file.
    const items = parseInstagram([
      { id: '4', media_type: 'VIDEO', media_url: 'https://cdn/v.mp4', permalink: 'https://instagram.com/p/c', like_count: 90, timestamp: '2026-08-31T00:00:00Z' },
    ], 'nailart', NOW);
    expect(items).toHaveLength(1);
    expect(items[0].thumbUrl).toBeNull();
    expect(items[0].count).toBe(90);
  });

  it('keeps the card when Instagram hides the like count', () => {
    const items = parseInstagram([
      { id: '5', media_type: 'IMAGE', media_url: 'https://cdn/e.jpg', permalink: 'https://instagram.com/p/e', caption: 'Hidden likes', timestamp: '2026-08-31T00:00:00Z' },
    ], 'nailart', NOW);
    expect(items).toHaveLength(1);
    expect(items[0].count).toBeNull();
    expect(items[0].perDay).toBeNull();
  });

  it('reads the rising list out of a DataForSEO Google Trends result, and keeps breakouts', () => {
    const qs = parseGoogleTrends({
      items: [
        { type: 'google_trends_graph', data: [] },
        { type: 'google_trends_queries_list', data: {
          top: [{ query: 'nail salon near me', value: 100 }],
          rising: [
            { query: 'chrome nails', value: 140 },
            { query: 'labor day nails', value: 'Breakout' },
            { query: 'chrome nails', value: 90 },
            { query: '', value: 10 },
          ],
        } },
      ],
    });
    expect(qs.map((q) => q.query)).toEqual(['chrome nails', 'labor day nails']);
    expect(qs[0].growthPct).toBe(140);
    expect(qs[1].breakout).toBe(true);
    expect(qs[1].growthPct).toBeNull();
  });

  it('parses ISO durations and shrugs at anything else', () => {
    expect(isoDurationSec('PT1M42S')).toBe(102);
    expect(isoDurationSec('PT2H')).toBe(7200);
    expect(isoDurationSec('nonsense')).toBeNull();
  });
});

describe('what "rising" means for a video', () => {
  it('scores a fresh video above an old one with more views, by pace', () => {
    const fresh = perDayOf(200_000, '2026-08-31T12:00:00Z', NOW);
    const old = perDayOf(400_000, '2026-08-01T12:00:00Z', NOW);
    expect(fresh).toBe(200_000);
    expect(old!).toBeLessThan(fresh!);
  });

  it('has nothing to say without a count or a date', () => {
    expect(perDayOf(null, '2026-08-31T12:00:00Z', NOW)).toBeNull();
    expect(perDayOf(10, null, NOW)).toBeNull();
  });

  it('never prints a percent from a single snapshot', () => {
    // The first version printed "+100% this week" on every card because the
    // search window was seven days and the maths pretended that was growth.
    const items = parseYouTube([
      { id: 'a', snippet: { title: 'nail art', publishedAt: '2026-08-30T12:00:00Z' }, statistics: { viewCount: '1000' } },
    ], 'nail art', NOW);
    expect(items[0].growthPct).toBeNull();
    expect(items[0].perDay).toBe(500);
  });

  it('gives a real percent once the same item has been seen twice', () => {
    const today = parseYouTube([
      { id: 'a', snippet: { title: 'nail art', publishedAt: '2026-08-30T12:00:00Z' }, statistics: { viewCount: '1380' } },
      { id: 'b', snippet: { title: 'new nails', publishedAt: '2026-08-31T12:00:00Z' }, statistics: { viewCount: '50' } },
    ], 'nail art', NOW);
    const yesterday = [{ ...today[0], count: 1000 }];
    const out = withGrowth(today, yesterday);
    expect(out[0].growthPct).toBe(38);
    expect(out[1].growthPct).toBeNull();
  });
});

describe('keeping the feed about the trade', () => {
  const item = (title: string, via = 'nail art'): TrendItem => ({
    id: title, source: 'youtube', title, url: 'u', thumbUrl: null, count: 1, perDay: 1, growthPct: null,
    breakout: false, publishedAt: null, durationSec: null, via,
  });

  it('drops a view-count winner whose title is not about nails', () => {
    const kept = relevant([
      item('behind the scene: Super Handsome Light Ring'),
      item("I didn't expect this 😱 #funny"),
      item('Ranking The Best Nail Polish Squishy Trend'),
      item('Chrome cat-eye on almond nails'),
    ], 'SALON', 'US');
    expect(kept.map((k) => k.title)).toEqual(['Ranking The Best Nail Polish Squishy Trend', 'Chrome cat-eye on almond nails']);
  });

  it('drops a title the market cannot read, and keeps Vietnamese', () => {
    expect(latinShare('関西人4280円が言えない #ジェルネイル')).toBeLessThan(0.6);
    expect(latinShare('Mẫu nail đẹp tháng 9')).toBe(1);
    const kept = relevant([item('関西人4280円が言えない nails'), item('Mẫu nails đẹp tháng 9')], 'SALON', 'US');
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toMatch(/Mẫu/);
  });

  it('lets a hashtag stand in for the title on Instagram', () => {
    const ig: TrendItem = { ...item('✨✨', '#nailart'), source: 'instagram' };
    expect(relevant([ig], 'SALON', 'US')).toHaveLength(1);
  });
});

describe('matching a trend to what this salon sells', () => {
  it('matches on the meaningful words of the service name, not the filler', () => {
    expect(serviceKeywords('Luxury Manicure')).toEqual(['manicure']);
    expect(serviceKeywords('Colour (add-on)')).toEqual(['colour']);
    expect(matchService('Chrome cat-eye manicure ideas', ['Luxury Manicure', 'Pedicure'])).toBe('Luxury Manicure');
    expect(matchService('Fall pedicure colours', ['Luxury Manicure', 'Pedicure'])).toBe('Pedicure');
  });

  it('never tags everything because one service is called "add-on"', () => {
    expect(matchService('Anything with an add-on set', ['Colour (add-on)'])).toBeNull();
  });

  it('reads hashtags as words', () => {
    expect(matchService('#manicure #nails', ['Luxury Manicure'])).toBe('Luxury Manicure');
  });
});

describe('ranking and the overlay', () => {
  const item = (o: Partial<TrendItem>): TrendItem => ({
    id: 'x', source: 'youtube', title: 't', url: 'u', thumbUrl: null, count: null, perDay: null, growthPct: null,
    breakout: false, publishedAt: null, durationSec: null, via: null, ...o,
  });

  it('puts what is moving fastest first, whichever feed it came from', () => {
    const r = rankItems([
      item({ id: 'a', source: 'youtube', perDay: 20, count: 900_000 }),
      item({ id: 'b', source: 'instagram', perDay: 80, count: 5_000 }),
      item({ id: 'c', perDay: 80, count: 9_000 }),
    ]);
    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps one hashtag or creator from owning the whole screen', () => {
    const many = Array.from({ length: 10 }, (_, i) => item({ id: `a${i}`, title: `same via ${i}`, via: '#nailart', perDay: 50 }));
    const other = item({ id: 'o', title: 'other', via: '#naildesign', perDay: 10 });
    const out = diversify([...many, other], 4, 12);
    expect(out.filter((x) => x.via === '#nailart')).toHaveLength(4);
    expect(out.some((x) => x.id === 'o')).toBe(true);
  });

  it('drops a duplicate title', () => {
    const out = diversify([item({ id: '1', title: 'Same' }), item({ id: '2', title: 'same' })]);
    expect(out).toHaveLength(1);
  });

  it('annotates each card with the salon service and the upcoming holiday it is about', () => {
    const cards = overlay(
      [item({ id: 'a', title: 'Labor Day nail set: red, white and a star', count: 96_000, perDay: 48_000, growthPct: 210, publishedAt: '2026-08-30T12:00:00Z' }),
       item({ id: 'b', title: 'Chrome manicure', count: 1_200_000 })],
      { services: ['Luxury Manicure'], events: [{ name: bi('Lễ Lao động', 'Labor Day'), daysAway: 6 }] },
      NOW,
    );
    expect(viOf(cards[0].matchesEvent)).toBe('Lễ Lao động');
    expect(enOf(cards[0].matchesEvent)).toBe('Labor Day');
    expect(cards[0].countLabel).toBe('96K');
    expect(enOf(cards[0].perDayLabel)).toBe('48K views/day');
    expect(enOf(cards[0].growthLabel)).toBe('+210% since yesterday');
    expect(enOf(cards[0].ageLabel)).toBe('2d ago');
    expect(cards[1].growthLabel).toBeNull();
    expect(cards[1].matchesService).toBe('Luxury Manicure');
    expect(cards[1].countLabel).toBe('1.2M');
  });

  it('marks rising searches that name a service the salon sells', () => {
    const qs = overlayQueries([{ query: 'gel manicure near me', growthPct: 40, breakout: false, matchesService: null }], ['Luxury Manicure']);
    expect(qs[0].matchesService).toBe('Luxury Manicure');
  });

  it('prints counts the way a phone does', () => {
    expect(shortCount(980)).toBe('980');
    expect(shortCount(28_400)).toBe('28.4K');
    expect(shortCount(412_000)).toBe('412K');
    expect(shortCount(null)).toBeNull();
  });
});

describe('sharing one pull across every salon in a trade', () => {
  it('keys the shared snapshot on trade and market only', () => {
    expect(scopeOf('SALON', 'US')).toBe('SALON:US');
    expect(scopeOf('salon', 'ca')).toBe('SALON:CA');
    expect(scopeOf('BOGUS', 'MX')).toBe('SALON:US');
  });

  it('asks each feed at most three things per trade, because every one is a paid call', () => {
    for (const ind of ['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE']) {
      const q = queriesFor(ind);
      expect(q.youtube.length).toBeLessThanOrEqual(3);
      expect(q.hashtags.length).toBeLessThanOrEqual(3);
      expect(q.google.length).toBeLessThanOrEqual(3);
    }
  });

  it('pulls again once a day, not on every hourly tick', () => {
    expect(needsRefresh(null, NOW)).toBe(true);
    expect(needsRefresh(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe(false);
    expect(needsRefresh(new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe(true);
  });
});
