import { FEATURE_DEFS, GOVERNED_HREFS, OPEN_BY_DEFAULT, resolvePolicy } from './feature-policy.constants';

/** The nine menu rows under "Marketing & AI", each of which needs its own switch. */
const MARKETING_HREFS = [
  '/salon/content',
  '/salon/marketing',
  '/salon/marketing/monthly',
  '/salon/email',
  '/salon/reviews',
  '/salon/reviews-replies',
  '/salon/inbox',
  '/salon/messenger',
  '/salon/voice',
];

describe('every menu row a salon can be sold has a switch', () => {
  it.each(MARKETING_HREFS)('%s is governed by exactly one key', (href) => {
    const owners = FEATURE_DEFS.filter((f) => f.hrefs.includes(href));
    expect(owners).toHaveLength(1);
  });

  it('lists no route twice, so one switch cannot silently override another', () => {
    expect(new Set(GOVERNED_HREFS).size).toBe(GOVERNED_HREFS.length);
  });

  it('has a unique key per feature', () => {
    const keys = FEATURE_DEFS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('nothing opens by accident', () => {
  it('ships every switch OFF except the one screen allowed to be open', () => {
    // The rule has not been relaxed, it has been made explicit: a second
    // screen shipping open is now a test failure rather than a one-word diff.
    for (const f of FEATURE_DEFS) {
      expect(f.default).toBe(OPEN_BY_DEFAULT.includes(f.key) ? 'salon' : 'platform');
    }
  });

  it('the open list is exactly what it is meant to be', () => {
    // Every entry here must clear the same bar: the screen is EMPTY until the
    // agency itself puts something on it, so the default reveals a door and
    // never any data.
    expect(OPEN_BY_DEFAULT).toEqual(['postApproval']);
  });

  it('an open-by-default switch inherits from nothing, or the default is a lie', () => {
    for (const f of FEATURE_DEFS) {
      if (OPEN_BY_DEFAULT.includes(f.key)) expect(f.fallbackKey).toBeUndefined();
    }
  });

  it('a salon with no stored policy gets platform for everything else', () => {
    const p = resolvePolicy({});
    for (const f of FEATURE_DEFS) {
      expect(p[f.key]).toBe(OPEN_BY_DEFAULT.includes(f.key) ? 'salon' : 'platform');
    }
  });

  it('an explicit decision still wins over the default, in both directions', () => {
    expect(resolvePolicy({ postApproval: 'platform' }).postApproval).toBe('platform');
    expect(resolvePolicy({ marketing: 'salon' }).marketing).toBe('salon');
  });

  it('ignores junk in the stored policy rather than trusting it', () => {
    const p = resolvePolicy({ marketing: 'yes', voiceAi: 1, inbox: null } as Record<string, unknown>);
    expect(p.marketing).toBe('platform');
    expect(p.voiceAi).toBe('platform');
    expect(p.inbox).toBe('platform');
  });
});

describe('splitting one switch into two takes nothing away', () => {
  // The report used to ride along with 'marketing', and replying to Google
  // reviews used to ride along with 'reviews'. A salon already paying for
  // either must keep what it had, without anyone touching Super Admin.
  it('a salon sold Marketing keeps the monthly report', () => {
    const p = resolvePolicy({ marketing: 'salon' });
    expect(p.marketing).toBe('salon');
    expect(p.marketingReport).toBe('salon');
  });

  it('a salon sold Reviews keeps Google reviews', () => {
    const p = resolvePolicy({ reviews: 'salon' });
    expect(p.reviews).toBe('salon');
    expect(p.googleReviews).toBe('salon');
  });

  it('an explicit value on the new key wins over what it inherits', () => {
    const p = resolvePolicy({ marketing: 'salon', marketingReport: 'platform' });
    expect(p.marketing).toBe('salon');
    expect(p.marketingReport).toBe('platform');
  });

  it('inheriting from an OFF parent stays off', () => {
    const p = resolvePolicy({ reviews: 'platform' });
    expect(p.googleReviews).toBe('platform');
  });
});

describe('the market has the last word', () => {
  it('a feature not sold in this market stays platform even when ticked', () => {
    const p = resolvePolicy({ voiceAi: 'salon', marketing: 'salon' }, (k) => k !== 'voiceAi');
    expect(p.voiceAi).toBe('platform');
    expect(p.marketing).toBe('salon');
  });
});
