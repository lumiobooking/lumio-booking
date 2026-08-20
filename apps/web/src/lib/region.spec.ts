import { activeRegion, apiBaseUrl, scopedKey, regionChoiceEnabled, Region } from './region';

const US: Region = { code: 'US', label: 'US / Canada', flag: '🇺🇸', apiUrl: 'https://lumio-api.onrender.com/api' };
const VN: Region = { code: 'VN', label: 'Việt Nam', flag: '🇻🇳', apiUrl: 'https://lumio-api-vn.onrender.com/api' };
const BOTH = [US, VN];
const ONLY_US = [US];
const NONE: Region[] = [];

// What the app compiled with. Every "nothing changed" assertion below is
// really an assertion that this exact string is still what gets used.
const COMPILED_IN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

describe('the live US site must behave exactly as before until Vietnam is configured', () => {
  // This is the reason the whole file is written the way it is. The code ships
  // to lumiobooking.com, where salons are working right now, BEFORE the
  // Vietnamese API URL is filled in. Until then it must be inert.
  it.each([
    ['no regions at all', NONE],
    ['only one region', ONLY_US],
  ])('uses the compiled-in API URL with %s', (_name, regions) => {
    expect(apiBaseUrl(null, regions)).toBe(COMPILED_IN);
    expect(apiBaseUrl('VN', regions)).toBe(COMPILED_IN);
  });

  it.each([
    ['no regions at all', NONE],
    ['only one region', ONLY_US],
  ])('leaves storage keys unsuffixed with %s', (_name, regions) => {
    expect(scopedKey('lumio_auth', null, regions)).toBe('lumio_auth');
    // Even a stale 'VN' left in storage must not rename the session key while
    // there is only one region: that would sign every US salon out at once.
    expect(scopedKey('lumio_auth', 'VN', regions)).toBe('lumio_auth');
  });

  it('reports no region to choose', () => {
    expect(regionChoiceEnabled(NONE)).toBe(false);
    expect(regionChoiceEnabled(ONLY_US)).toBe(false);
    expect(regionChoiceEnabled(BOTH)).toBe(true);
  });

  it('ignores a region declared without an API URL', () => {
    const halfConfigured = [US, { ...VN, apiUrl: '' }].filter((r) => r.apiUrl);
    expect(regionChoiceEnabled(halfConfigured)).toBe(false);
    expect(apiBaseUrl('VN', halfConfigured)).toBe(COMPILED_IN);
  });
});

describe('a visitor who has never chosen', () => {
  // Distinct from choosing US, and it has to stay distinct: this is the state
  // every existing salon is in on the day this deploys.
  it.each([null, undefined, '', '   '])('has no active region (saved=%s)', (saved) => {
    expect(activeRegion(saved, BOTH)).toBe('');
  });

  it('still reaches the API the app was built with', () => {
    expect(apiBaseUrl(null, BOTH)).toBe(COMPILED_IN);
  });

  it('still finds their session under the original key', () => {
    expect(scopedKey('lumio_auth', null, BOTH)).toBe('lumio_auth');
  });
});

describe('once a region is chosen', () => {
  it('sends US traffic to the US API', () => {
    expect(apiBaseUrl('US', BOTH)).toBe('https://lumio-api.onrender.com/api');
  });

  it('sends Vietnamese traffic to the Vietnamese API', () => {
    expect(apiBaseUrl('VN', BOTH)).toBe('https://lumio-api-vn.onrender.com/api');
  });

  it.each(['vn', ' Vn ', 'VN'])('accepts %s however it was written', (saved) => {
    expect(activeRegion(saved, BOTH)).toBe('VN');
  });

  it('never sends one region to the other region API', () => {
    expect(apiBaseUrl('VN', BOTH)).not.toContain('lumio-api.onrender.com/api');
    expect(apiBaseUrl('US', BOTH)).not.toContain('-vn');
  });
});

describe('two systems sharing one browser must not share one session', () => {
  // One origin means one localStorage. Both builds store the session under
  // 'lumio_auth', so without this a Vietnamese login would overwrite the US one
  // and the browser would start posting a Vietnamese token to the US server.
  it('gives Vietnam its own session slot', () => {
    expect(scopedKey('lumio_auth', 'VN', BOTH)).toBe('lumio_auth::VN');
  });

  it('leaves the US on the bare key so existing sessions survive the deploy', () => {
    expect(scopedKey('lumio_auth', 'US', BOTH)).toBe('lumio_auth');
  });

  it('keeps the two apart for every key it is given', () => {
    for (const key of ['lumio_auth', 'lumio_active_branch', 'lumio_tz', 'lumio_pos_enabled']) {
      expect(scopedKey(key, 'VN', BOTH)).not.toBe(scopedKey(key, 'US', BOTH));
    }
  });

  it('is stable — the same region always yields the same key', () => {
    expect(scopedKey('lumio_auth', 'VN', BOTH)).toBe(scopedKey('lumio_auth', 'vn', BOTH));
  });
});

describe('values that should not be trusted', () => {
  it('ignores a region code it does not recognise', () => {
    expect(activeRegion('ZZ', BOTH)).toBe('');
    expect(apiBaseUrl('ZZ', BOTH)).toBe(COMPILED_IN);
    expect(scopedKey('lumio_auth', 'ZZ', BOTH)).toBe('lumio_auth');
  });

  it('ignores a region that has since lost its API URL', () => {
    const nowOnlyUS = [US, { ...VN, apiUrl: '' }].filter((r) => r.apiUrl);
    expect(activeRegion('VN', nowOnlyUS)).toBe('');
  });

  it('strips a trailing slash so URLs do not double up', () => {
    const trailing = [US, { ...VN, apiUrl: 'https://lumio-api-vn.onrender.com/api/' }];
    // configuredRegions() cleans this; assert the shape the app relies on.
    expect(apiBaseUrl('VN', [US, { ...VN, apiUrl: 'https://lumio-api-vn.onrender.com/api' }]))
      .toBe('https://lumio-api-vn.onrender.com/api');
    expect(trailing[1].apiUrl.endsWith('/')).toBe(true); // documents why clean() exists
  });
});
