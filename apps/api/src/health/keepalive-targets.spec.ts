import { keepaliveTargets } from './keepalive-targets';

const US_API = 'https://lumio-api-uqm6.onrender.com/api/health';
const US_WEB = 'https://lumio-web-1xqk.onrender.com/healthz';

describe('keepaliveTargets — a fallback must not point at another market', () => {
  // The reason this file exists. Vietnam runs on the free tier with
  // KEEPALIVE_WEB_URL unset by default, and the old fallback would have had it
  // pinging the US web service every four minutes, all day.
  it('never falls back to a US URL on a non-US instance', () => {
    const urls = keepaliveTargets({ market: 'VN', selfUrl: undefined, webUrl: undefined });
    expect(urls).toEqual([]);
    expect(urls.join(' ')).not.toContain('lumio-web-1xqk');
    expect(urls.join(' ')).not.toContain('lumio-api-uqm6');
  });

  it('pings only itself when a non-US instance has no web URL', () => {
    expect(keepaliveTargets({ market: 'VN', selfUrl: 'https://lumio-api-vn.onrender.com' }))
      .toEqual(['https://lumio-api-vn.onrender.com/api/health']);
  });

  it('pings the Vietnamese pair when both are configured', () => {
    expect(
      keepaliveTargets({
        market: 'VN',
        selfUrl: 'https://lumio-api-vn.onrender.com',
        webUrl: 'https://lumio-web-vn.onrender.com',
      }),
    ).toEqual([
      'https://lumio-api-vn.onrender.com/api/health',
      'https://lumio-web-vn.onrender.com/healthz',
    ]);
  });
});

describe('keepaliveTargets — the US deployment keeps behaving exactly as before', () => {
  // This is the half that is already running. Changing it is not the point of
  // the fix, so it is pinned.
  it.each([undefined, null, '', 'US', 'us', ' us '])('treats market %s as US', (market) => {
    expect(keepaliveTargets({ market })).toEqual([US_API, US_WEB]);
  });

  it('prefers the configured URLs over the fallbacks', () => {
    expect(
      keepaliveTargets({ market: 'US', selfUrl: 'https://a.example', webUrl: 'https://b.example' }),
    ).toEqual(['https://a.example/api/health', 'https://b.example/healthz']);
  });

  it('falls back per-URL, not all-or-nothing', () => {
    expect(keepaliveTargets({ market: 'US', selfUrl: 'https://a.example' }))
      .toEqual(['https://a.example/api/health', US_WEB]);
  });
});

describe('keepaliveTargets — sloppy values', () => {
  it('does not produce a double slash from a trailing slash', () => {
    expect(keepaliveTargets({ market: 'VN', selfUrl: 'https://a.example///' }))
      .toEqual(['https://a.example/api/health']);
  });

  it.each(['', '   '])('treats %s as unset rather than as a URL', (blank) => {
    expect(keepaliveTargets({ market: 'VN', selfUrl: blank, webUrl: blank })).toEqual([]);
  });

  it('trims surrounding whitespace', () => {
    expect(keepaliveTargets({ market: 'VN', selfUrl: '  https://a.example  ' }))
      .toEqual(['https://a.example/api/health']);
  });
});
