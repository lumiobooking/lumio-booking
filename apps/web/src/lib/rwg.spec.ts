/**
 * Reserve with Google: the referral token is kept 30 days on the root domain,
 * and the conversion ping carries exactly the three fields Google asks for —
 * never when the visit did not come from the button.
 */
import { cookieDomain, readCookie, rwgConversion, rwgCookies, rwgRequest, rwgTokenFrom, RWG_ENDPOINT, RWG_SANDBOX_ENDPOINT } from './rwg';

describe('reserve with google referral', () => {
  it('reads the token off the landing URL, decoded', () => {
    expect(rwgTokenFrom('?utm_source=google&rwg_token=AFd1xn%3D%3D')).toBe('AFd1xn==');
    expect(rwgTokenFrom('?utm_source=google')).toBeNull();
    expect(rwgTokenFrom('')).toBeNull();
  });

  it('sets both cookies on the registrable domain for 30 days; localhost gets no domain', () => {
    const [tok, mer] = rwgCookies('AFd1xn==', 'mt-hawthorn-nail-spa', 'www.lumiobooking.com');
    expect(tok).toBe('_rwgToken=AFd1xn%3D%3D; max-age=2592000; path=/; SameSite=Lax; domain=lumiobooking.com; Secure');
    expect(mer).toContain('_rwgMerchant=mt-hawthorn-nail-spa');
    expect(cookieDomain('localhost')).toBeNull();
    expect(cookieDomain('127.0.0.1')).toBeNull();
    expect(rwgCookies('t', 'm', 'localhost')[0]).toBe('_rwgToken=t; max-age=2592000; path=/; SameSite=Lax');
  });

  it('reads a cookie back, decoded', () => {
    expect(readCookie('a=1; _rwgToken=AFd1xn%3D%3D; b=2', '_rwgToken')).toBe('AFd1xn==');
    expect(readCookie('a=1', '_rwgToken')).toBeNull();
  });

  it('pings only with a token AND a partner id; same merchant = "2", another salon = "1"', () => {
    const jar = '_rwgToken=AFd1xn%3D%3D; _rwgMerchant=mt-hawthorn-nail-spa';
    expect(rwgConversion(jar, '1234567', 'mt-hawthorn-nail-spa')).toEqual({ conversion_partner_id: '1234567', rwg_token: 'AFd1xn==', merchant_changed: '2' });
    expect(rwgConversion(jar, '1234567', 'other-salon')?.merchant_changed).toBe('1');
    expect(rwgConversion(jar, '', 'mt-hawthorn-nail-spa')).toBeNull();
    expect(rwgConversion('a=1', '1234567', 'mt-hawthorn-nail-spa')).toBeNull();
  });

  it('posts text/plain JSON to the collect endpoint (sandbox when asked)', () => {
    const body = rwgConversion('_rwgToken=t', '42', 'x')!;
    const r = rwgRequest(body);
    expect(r.url).toBe(RWG_ENDPOINT);
    expect(r.init.headers['Content-Type']).toBe('text/plain');
    expect(JSON.parse(r.init.body)).toEqual({ conversion_partner_id: '42', rwg_token: 't', merchant_changed: '2' });
    expect(rwgRequest(body, true).url).toBe(RWG_SANDBOX_ENDPOINT);
  });
});
