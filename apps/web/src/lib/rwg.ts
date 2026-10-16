/**
 * RESERVE WITH GOOGLE — the referral token and the conversion ping.
 *
 * When Google shows a salon's "Book online" button through the Actions Center
 * (Appointments Redirect), the link it opens carries `rwg_token=…`. Google
 * asks the partner to keep that token for 30 days and, when a booking that
 * began from the button is completed, to POST it back — that is how the
 * button is measured and kept. No personal data travels with it: a token, our
 * partner id, and whether the customer booked the same merchant.
 *
 * Pure helpers. The page reads the URL and writes the cookie; this file decides
 * what to write and what to send, and the spec pins it down.
 *
 * Reference: Actions Center › Appointments Redirect › Conversion tracking.
 */

export const RWG_COOKIE = '_rwgToken';
export const RWG_MERCHANT_COOKIE = '_rwgMerchant';
/** 30 days, the window Google attributes a referral for. */
export const RWG_MAX_AGE_SEC = 30 * 24 * 60 * 60;
export const RWG_ENDPOINT = 'https://www.google.com/maps/conversion/collect';
export const RWG_SANDBOX_ENDPOINT = 'https://www.google.com/maps/conversion/debug/collect';

/** The token on a landing URL, decoded, or null. */
export function rwgTokenFrom(search: string): string | null {
  try {
    const t = new URLSearchParams(search).get('rwg_token');
    return t && t.length <= 2048 ? t : null;
  } catch { return null; }
}

/** The registrable domain the cookie should sit on: "www.lumiobooking.com" → "lumiobooking.com"; localhost stays. */
export function cookieDomain(hostname: string): string | null {
  const h = hostname.toLowerCase();
  if (!h || h === 'localhost' || /^[\d.]+$/.test(h) || !h.includes('.')) return null;
  const parts = h.split('.');
  return parts.slice(-2).join('.');
}

/** The two Set-Cookie strings for a referral: the token, and which merchant it was for. */
export function rwgCookies(token: string, merchant: string, hostname: string): string[] {
  const dom = cookieDomain(hostname);
  const tail = `; max-age=${RWG_MAX_AGE_SEC}; path=/; SameSite=Lax${dom ? `; domain=${dom}` : ''}${dom ? '; Secure' : ''}`;
  return [
    `${RWG_COOKIE}=${encodeURIComponent(token)}${tail}`,
    `${RWG_MERCHANT_COOKIE}=${encodeURIComponent(merchant)}${tail}`,
  ];
}

/** Read one cookie by name from document.cookie. */
export function readCookie(cookie: string, name: string): string | null {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * What to POST when a booking completes, or null when this visit did not
 * come from Google's button (no token) or the partner id is not configured.
 * `merchant_changed` is "2" (same merchant) unless the token was captured for
 * another salon's page — a customer can land on one salon's button and book
 * at another only by typing a new URL, so "1" is rare but honest.
 */
export function rwgConversion(cookie: string, partnerId: string | undefined, merchant: string): { conversion_partner_id: string; rwg_token: string; merchant_changed: '1' | '2' } | null {
  const pid = (partnerId ?? '').trim();
  if (!pid) return null;
  const token = readCookie(cookie, RWG_COOKIE);
  if (!token) return null;
  const forMerchant = readCookie(cookie, RWG_MERCHANT_COOKIE);
  return { conversion_partner_id: pid, rwg_token: token, merchant_changed: forMerchant && forMerchant !== merchant ? '1' : '2' };
}

/** Google wants text/plain with a JSON string body; any other content type is a CORS error. */
export function rwgRequest(body: NonNullable<ReturnType<typeof rwgConversion>>, sandbox = false): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string; keepalive: true } } {
  return {
    url: sandbox ? RWG_SANDBOX_ENDPOINT : RWG_ENDPOINT,
    init: { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), keepalive: true },
  };
}
