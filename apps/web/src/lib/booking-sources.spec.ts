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


describe('the referrer tells the organic truth', () => {
  it('a Google search click into the Lumio link IS Google traffic', () => {
    expect(srcKey({ source: 'hosted', attrReferrer: 'https://www.google.com/' })).toBe('gmap');
  });
  it('Facebook and Instagram referrers land on their own chips', () => {
    expect(srcKey({ source: 'hosted', attrReferrer: 'https://l.facebook.com/l.php?u=x' })).toBe('facebook');
    expect(srcKey({ source: 'plugin', attrReferrer: 'https://www.instagram.com/' })).toBe('instagram');
  });
  it('a deliberate UTM beats the referrer', () => {
    expect(srcKey({ source: 'hosted', utmSource: 'zalo', attrReferrer: 'https://www.google.com/' })).toBe('zalo');
  });
  it('named doors ignore the referrer — a Messenger booking stays Messenger', () => {
    expect(srcKey({ source: 'messenger', attrReferrer: 'https://www.google.com/' })).toBe('messenger');
  });
  it('garbage or missing referrers change nothing', () => {
    expect(srcKey({ source: 'hosted', attrReferrer: 'not a url' })).toBe('lumiolink');
    expect(srcKey({ source: 'hosted', attrReferrer: '' })).toBe('lumiolink');
    // the salon's own site linking to its own booking page is not a "source"
    expect(srcKey({ source: 'hosted', attrReferrer: 'https://familysmarthomes.com/book' })).toBe('lumiolink');
  });
});

/**
 * THE SIGNAL THAT CANNOT GO MISSING.
 *
 * A salon's book showed 95 bookings through the Lumio link and zero from
 * Google Maps, while the owner watched Google customers walk in all week.
 * Nothing in the chain was broken — the /gbp route exists, it stamps the
 * campaign, the API accepts and stores it, and this function maps it. The
 * tally read zero because both of the signals it had can simply be absent:
 *
 *   the utm       is only there once the salon has actually pasted the /gbp
 *                 link into its Google profile
 *   the referrer  is empty for most Google Maps traffic — the Maps app opens
 *                 the link in an in-app browser, which has no document.referrer
 *
 * The landing URL still ends in /gbp when both of those fail, which is the
 * whole reason it is now read.
 */
describe('a Google Maps booking is still Google when the tags go missing', () => {
  const hosted = { source: 'hosted' as const };

  it('reads the /gbp path off the landing URL with no utm and no referrer', () => {
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/model-nails-salon/gbp' })).toBe('gmap');
  });

  it('still reads it when the stamping effect DID run and added the campaign', () => {
    expect(srcKey({
      ...hosted,
      attrLandingUrl: 'https://lumiobooking.com/model-nails-salon/gbp?utm_source=google&utm_medium=organic',
    })).toBe('gmap');
  });

  it('tolerates a trailing slash and a hash', () => {
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/x/gbp/' })).toBe('gmap');
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/x/gbp#book' })).toBe('gmap');
  });

  it('does NOT claim a plain booking link', () => {
    // The bug this replaces went the other way; the fix must not overcorrect.
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/model-nails-salon' })).toBe('lumiolink');
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/gbp-nails' })).toBe('lumiolink');
    expect(srcKey({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/x?ref=gbp' })).toBe('lumiolink');
  });

  it('lets an explicit campaign and a real referrer win over the path', () => {
    // Somebody who built a tracked link meant it; the path is the last resort.
    expect(srcKey({ ...hosted, utmSource: 'facebook', attrLandingUrl: 'https://x.com/a/gbp' })).toBe('facebook');
    expect(srcKey({ ...hosted, attrReferrer: 'https://www.instagram.com/', attrLandingUrl: 'https://x.com/a/gbp' })).toBe('instagram');
  });

  it('never lets a door that already knows itself be overridden', () => {
    expect(srcKey({ source: 'messenger', attrLandingUrl: 'https://x.com/a/gbp' })).toBe('messenger');
    expect(srcKey({ source: 'walkin', attrLandingUrl: 'https://x.com/a/gbp' })).toBe('walkin');
  });

  it('survives a landing URL that is not a URL at all', () => {
    expect(srcKey({ ...hosted, attrLandingUrl: 'not a url' })).toBe('lumiolink');
    expect(srcKey({ ...hosted, attrLandingUrl: '' })).toBe('lumiolink');
    expect(srcKey({ ...hosted, attrLandingUrl: null })).toBe('lumiolink');
  });
});
