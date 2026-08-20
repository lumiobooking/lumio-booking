import { decideRegion, Region } from './region';

const US: Region = { code: 'US', label: 'US / Canada', flag: '🇺🇸', url: 'https://lumiobooking.com' };
const VN: Region = { code: 'VN', label: 'Việt Nam', flag: '🇻🇳', url: 'https://vn.lumiobooking.com' };
const BOTH = [US, VN];

describe('decideRegion — the US site must not change until Vietnam is configured', () => {
  // The single most important case here. This code ships to lumiobooking.com,
  // where salons are working today, before the Vietnamese URL is filled in.
  // Until then it must do absolutely nothing: no prompt, no redirect.
  it('stays put when only one region has a URL', () => {
    expect(decideRegion({ regions: [US, { ...VN, url: '' }], saved: null })).toEqual({ action: 'stay' });
  });

  it('stays put when no region has a URL', () => {
    expect(decideRegion({ regions: [{ ...US, url: '' }, { ...VN, url: '' }], saved: null })).toEqual({ action: 'stay' });
  });

  it.each(['', '   '])('treats a blank URL (%s) as not configured', (blank) => {
    expect(decideRegion({ regions: [US, { ...VN, url: blank }], saved: 'VN' })).toEqual({ action: 'stay' });
  });
});

describe('decideRegion — ask once, then never again', () => {
  it.each([null, undefined, '', '   '])('asks on the first visit (saved=%s)', (saved) => {
    expect(decideRegion({ regions: BOTH, saved })).toEqual({ action: 'ask' });
  });

  it('stays silent once the visitor is where they chose to be', () => {
    expect(decideRegion({ regions: BOTH, saved: 'VN', currentMarket: 'VN' })).toEqual({ action: 'stay' });
    expect(decideRegion({ regions: BOTH, saved: 'US', currentMarket: 'US' })).toEqual({ action: 'stay' });
  });

  it('carries a returning Vietnamese visitor across without asking', () => {
    expect(decideRegion({ regions: BOTH, saved: 'VN', currentMarket: 'US' }))
      .toEqual({ action: 'go', url: 'https://vn.lumiobooking.com', code: 'VN' });
  });

  it('carries a returning US visitor back the other way', () => {
    expect(decideRegion({ regions: BOTH, saved: 'US', currentMarket: 'VN' }))
      .toEqual({ action: 'go', url: 'https://lumiobooking.com', code: 'US' });
  });

  it('treats a deployment with no MARKET as the US one', () => {
    expect(decideRegion({ regions: BOTH, saved: 'US', currentMarket: undefined })).toEqual({ action: 'stay' });
  });

  it.each(['vn', ' Vn ', 'VN'])('accepts a saved value written as %s', (saved) => {
    expect(decideRegion({ regions: BOTH, saved, currentMarket: 'US' }).action).toBe('go');
  });
});

describe('decideRegion — refusing to send someone in a circle', () => {
  // One wrong URL in the dashboard should look like a wrong URL, not like a
  // site that hangs. Without this the browser bounces forever.
  it('does not redirect to the host it is already on', () => {
    expect(
      decideRegion({
        regions: [US, { ...VN, url: 'https://lumiobooking.com' }],
        saved: 'VN',
        currentMarket: 'US',
        currentHost: 'lumiobooking.com',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('ignores www. when comparing hosts', () => {
    expect(
      decideRegion({
        regions: [US, { ...VN, url: 'https://www.lumiobooking.com' }],
        saved: 'VN',
        currentMarket: 'US',
        currentHost: 'lumiobooking.com',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('still redirects when the hosts genuinely differ', () => {
    expect(
      decideRegion({ regions: BOTH, saved: 'VN', currentMarket: 'US', currentHost: 'lumiobooking.com' }).action,
    ).toBe('go');
  });
});

describe('decideRegion — values that should not be trusted', () => {
  it('asks again rather than acting on a region it does not recognise', () => {
    expect(decideRegion({ regions: BOTH, saved: 'ZZ', currentMarket: 'US' })).toEqual({ action: 'ask' });
  });

  it('asks again when the saved region has since lost its URL', () => {
    expect(decideRegion({ regions: [US, VN, { code: 'AU', label: 'Úc', flag: '🇦🇺', url: '' }], saved: 'AU' }))
      .toEqual({ action: 'ask' });
  });

  it('drops a trailing slash so the redirect is clean', () => {
    expect(decideRegion({ regions: [US, { ...VN, url: 'https://vn.lumiobooking.com/' }], saved: 'VN', currentMarket: 'US' }))
      .toEqual({ action: 'go', url: 'https://vn.lumiobooking.com', code: 'VN' });
  });

  it('does not crash on a malformed URL', () => {
    expect(() =>
      decideRegion({ regions: [US, { ...VN, url: 'not a url' }], saved: 'VN', currentMarket: 'US', currentHost: 'x.com' }),
    ).not.toThrow();
  });
});
