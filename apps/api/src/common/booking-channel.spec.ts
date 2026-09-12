import { bookingChannel, PLATFORM_OF, channelCoverage } from './booking-channel';

/**
 * WHY THIS FILE EXISTS.
 *
 * A salon's book showed 95 bookings through the Lumio link and ZERO from
 * Google Maps, while the owner watched Google customers walk in all week. Every
 * link in the chain checked out: the /gbp route exists, it stamps the campaign,
 * the DTO accepts it, the service stores it, this function maps it.
 *
 * The tally read zero because both signals this function had can be absent at
 * once. The utm is only there once the salon has pasted the /gbp link into its
 * Google profile — until then a Google customer lands on the plain link with
 * nothing on it. And the referrer, the fallback written for exactly that case,
 * is empty for most Google Maps traffic: the Maps app opens the booking link in
 * an in-app browser, and an in-app browser has no document.referrer.
 *
 * The landing URL is the third signal and the only one that cannot go missing.
 */
describe('the Google booking that the book could not see', () => {
  const hosted = { source: 'hosted' };

  it('is Google when only the landing path says so', () => {
    expect(bookingChannel({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/model-nails-salon/gbp' })).toBe('gmap');
    expect(PLATFORM_OF[bookingChannel({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/x/gbp' })]).toBe('google');
  });

  it('is Google by utm, by referrer, or by path — any one of the three', () => {
    expect(bookingChannel({ ...hosted, utmSource: 'google' })).toBe('gmap');
    expect(bookingChannel({ ...hosted, attrReferrer: 'https://www.google.com/' })).toBe('gmap');
    expect(bookingChannel({ ...hosted, attrLandingUrl: 'https://a.com/b/gbp' })).toBe('gmap');
  });

  it('DOES NOT claim the plain link — the fix must not overcorrect', () => {
    expect(bookingChannel({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/model-nails-salon' })).toBe('lumiolink');
    expect(bookingChannel({ ...hosted, attrLandingUrl: 'https://lumiobooking.com/gbp-nails' })).toBe('lumiolink');
  });

  it('keeps the order of evidence: a deliberate campaign beats the path', () => {
    expect(bookingChannel({ ...hosted, utmSource: 'fb', attrLandingUrl: 'https://a.com/b/gbp' })).toBe('facebook');
  });

  it('keeps the door above all of it', () => {
    expect(bookingChannel({ source: 'messenger', attrLandingUrl: 'https://a.com/b/gbp' })).toBe('messenger');
    expect(bookingChannel({ source: 'walkin', utmSource: 'google' })).toBe('walkin');
  });

  it('is unfazed by a landing URL that is not a URL', () => {
    for (const bad of ['not a url', '', null, undefined]) {
      expect(bookingChannel({ ...hosted, attrLandingUrl: bad })).toBe('lumiolink');
    }
  });
});

/**
 * The parity this file also guards: the API and the web app each carry a copy
 * of this rule, and a split brain here is a salon told two different stories
 * about the same booking on two different screens.
 */
describe('the rule the two copies have to agree on', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ source: 'hosted' }, 'lumiolink'],
    [{ source: 'hosted', attrLandingUrl: 'https://a.com/x/gbp' }, 'gmap'],
    [{ source: 'hosted', utmSource: 'google' }, 'gmap'],
    [{ source: 'hosted', attrReferrer: 'https://maps.google.com/' }, 'gmap'],
    [{ source: 'plugin' }, 'website'],
    [{ source: 'plugin', attrReferrer: 'https://www.facebook.com/' }, 'facebook'],
    [{ source: 'admin' }, 'staff'],
    [{ source: '' }, 'online'],
  ];
  it.each(cases)('%j → %s', (input, want) => {
    expect(bookingChannel(input)).toBe(want);
  });
});

describe('how much of the book can be attributed at all', () => {
  it('counts the unknowns rather than hiding them', () => {
    const c = channelCoverage(['gmap', 'facebook', 'online', 'online']);
    expect(c).toEqual({ total: 4, attributed: 2, unknown: 2, ownedDoor: 0, pct: 50 });
  });

  it('A DOOR IS NOT A SOURCE — a hosted-link booking with no utm is unknown', () => {
    // The salon's screen said "Link Lumio 95 · Tạo tại tiệm 34" and reported
    // full coverage, while its owner was telling us customers plainly come
    // from Google and nothing records it. Both were true: the hosted page is
    // the door they walked through, not what sent them to it.
    const c = channelCoverage(['gmap', 'lumiolink', 'lumiolink', 'website', 'online']);
    expect(c.attributed).toBe(1);
    expect(c.unknown).toBe(4);
    expect(c.pct).toBe(20);
  });

  it('separates the ones that are a single link away from being measurable', () => {
    const c = channelCoverage(['lumiolink', 'lumiolink', 'website', 'online', 'online']);
    expect(c.unknown).toBe(5);
    // three came through a door we own; two carry no trace at all
    expect(c.ownedDoor).toBe(3);
  });

  it('keeps a real origin attributed even when it is not a marketing channel', () => {
    // A walk-in is not a channel we buy, but we know where she came from.
    const c = channelCoverage(['walkin', 'staff', 'hotline', 'online']);
    expect(c.attributed).toBe(3);
    expect(c.unknown).toBe(1);
  });
});
