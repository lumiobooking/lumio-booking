import { oauthBase } from './public-url.util';

/**
 * The regression this file exists to stop.
 *
 * Adding PUBLIC_API_URL — for an unrelated reason, the phone hotline — moved
 * every OAuth redirect on the platform to an address no provider had been
 * told about, and took down Connect Google, Connect Facebook and Connect
 * TikTok at once. The rule is: OAuth follows what is REGISTERED, and only a
 * deliberate OAUTH_BASE_URL moves it.
 */
describe('oauthBase', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['OAUTH_BASE_URL', 'RENDER_EXTERNAL_URL', 'PUBLIC_API_URL']) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const clear = () => {
    for (const k of ['OAUTH_BASE_URL', 'RENDER_EXTERNAL_URL', 'PUBLIC_API_URL']) delete process.env[k];
  };

  it('IGNORES PUBLIC_API_URL while the platform is on Render — the whole point', () => {
    clear();
    process.env.RENDER_EXTERNAL_URL = 'https://lumio-api.onrender.com';
    process.env.PUBLIC_API_URL = 'https://api.lumiobooking.com';
    expect(oauthBase()).toBe('https://lumio-api.onrender.com');
  });

  it('moves only when someone sets OAUTH_BASE_URL on purpose', () => {
    clear();
    process.env.RENDER_EXTERNAL_URL = 'https://lumio-api.onrender.com';
    process.env.PUBLIC_API_URL = 'https://api.lumiobooking.com';
    process.env.OAUTH_BASE_URL = 'https://api.lumiobooking.com';
    expect(oauthBase()).toBe('https://api.lumiobooking.com');
  });

  it('falls back to the API address off Render, so local dev still works', () => {
    clear();
    process.env.PUBLIC_API_URL = 'http://localhost:8005';
    expect(oauthBase()).toBe('http://localhost:8005');
  });

  it('never leaves a trailing slash — the provider compares character for character', () => {
    clear();
    process.env.OAUTH_BASE_URL = 'https://api.lumiobooking.com///';
    expect(oauthBase()).toBe('https://api.lumiobooking.com');
  });

  it('answers something usable even with nothing set at all', () => {
    clear();
    expect(oauthBase()).toMatch(/^https?:\/\/[^/]+$/);
  });
});
