import { srcKey, sourceCounts, SOURCE_META, SOURCE_ORDER } from './booking-sources';

describe('which chip a booking wears', () => {
  it.each([
    ['messenger', 'messenger'], ['instagram', 'instagram'], ['zalo', 'zalo'],
    ['hotline', 'hotline'], ['call', 'hotline'], ['phone', 'hotline'],
    ['walkin', 'walkin'], ['admin', 'staff'], ['manual', 'staff'],
    ['plugin', 'website'], ['wordpress', 'website'],
    ['hosted', 'lumiolink'], ['link', 'lumiolink'],
    ['gmap', 'gmap'], ['rwg', 'gmap'], ['gbp', 'gmap'], ['reserve_with_google', 'gmap'],
    ['online', 'online'], ['web', 'online'], ['mobile', 'online'],
  ] as const)("source '%s' → %s", (source, want) => {
    expect(srcKey({ source })).toBe(want);
  });

  it('the unknown and the empty land on online, never crash', () => {
    expect(srcKey({ source: null })).toBe('online');
    expect(srcKey({})).toBe('online');
    expect(srcKey({ source: 'somethingnew' })).toBe('online');
  });

  it('is case- and whitespace-proof', () => {
    expect(srcKey({ source: ' Messenger ' })).toBe('messenger');
  });
});

describe('utm refines the anonymous doors — and only those', () => {
  // The owner pays for Facebook ads that land on the website plugin. To her,
  // that booking is a FACEBOOK booking; "website" would hide exactly the number
  // she is trying to watch.
  it.each([
    ['facebook', 'facebook'], ['fb', 'facebook'],
    ['instagram', 'instagram'], ['ig', 'instagram'],
    ['google', 'gmap'], ['gbp', 'gmap'], ['maps', 'gmap'],
    ['zalo', 'zalo'],
  ] as const)("plugin + utm '%s' → %s", (utm, want) => {
    expect(srcKey({ source: 'plugin', utmSource: utm })).toBe(want);
    expect(srcKey({ source: 'hosted', utmSource: utm })).toBe(want);
    expect(srcKey({ source: 'online', utmSource: utm })).toBe(want);
  });

  it('an unknown utm leaves the door as it was', () => {
    expect(srcKey({ source: 'plugin', utmSource: 'tiktok-bio' })).toBe('website');
  });

  // The named doors outrank the parameter: a chat thread is stronger evidence
  // than a string someone pasted into a link.
  it('utm never overrides a named door', () => {
    expect(srcKey({ source: 'messenger', utmSource: 'google' })).toBe('messenger');
    expect(srcKey({ source: 'walkin', utmSource: 'facebook' })).toBe('walkin');
  });

  it('"ig" is matched as a word, not found inside other words', () => {
    expect(srcKey({ source: 'plugin', utmSource: 'campaign-light' })).toBe('website');
  });
});

describe('the legend', () => {
  it('counts per source and keeps the watch-list order', () => {
    const rows = [
      { source: 'messenger' }, { source: 'messenger' },
      { source: 'plugin', utmSource: 'facebook' },
      { source: 'gmap' }, { source: 'walkin' },
    ];
    const got = sourceCounts(rows);
    expect(got.map((x) => [x.meta.key, x.count])).toEqual([
      ['gmap', 1], ['facebook', 1], ['messenger', 2], ['walkin', 1],
    ]);
  });

  it('never lists a source with zero bookings — a row of zeros is a form, not information', () => {
    expect(sourceCounts([{ source: 'walkin' }]).map((x) => x.meta.key)).toEqual(['walkin']);
  });

  it('survives an empty month and rubbish rows', () => {
    expect(sourceCounts([])).toEqual([]);
    expect(sourceCounts([null as never, { source: 'walkin' }])).toHaveLength(1);
  });
});

describe('the palette itself', () => {
  it('every source in the order has a meta, and vice versa', () => {
    expect(new Set(SOURCE_ORDER)).toEqual(new Set(Object.keys(SOURCE_META)));
  });

  it('no two sources share a colour — the eye must be able to tell them apart', () => {
    const colors = Object.values(SOURCE_META).map((m) => m.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('every source speaks both languages', () => {
    for (const m of Object.values(SOURCE_META)) {
      expect(m.labelVi.length).toBeGreaterThan(1);
      expect(m.labelEn.length).toBeGreaterThan(1);
    }
  });
});
