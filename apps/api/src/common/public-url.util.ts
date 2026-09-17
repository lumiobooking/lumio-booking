// Single source of truth for the customer-facing web address.
//
// Salons share ONE clean booking link: https://lumiobooking.com/<salon-slug>
// (the web app rewrites /<slug> -> /book/<slug>, so the short form works).
//
// PUBLIC_WEB_URL can override the domain — e.g. a future white-label custom
// domain per salon. We deliberately do NOT chain through KEEPALIVE_WEB_URL here:
// the keepalive ping may target the raw Render host to wake the dyno, which is a
// different concern from the public, branded link customers actually see.

const DEFAULT_WEB_BASE = 'https://lumiobooking.com';

/** The branded public web origin, no trailing slash. */
export function publicWebBase(): string {
  return (process.env.PUBLIC_WEB_URL || DEFAULT_WEB_BASE).replace(/\/+$/, '');
}

/** Clean booking link for a salon: https://lumiobooking.com/<slug> */
export function bookingUrl(slug?: string | null): string {
  const base = publicWebBase();
  if (!slug) return base;
  return `${base}/${encodeURIComponent(slug)}`;
}

/** Booking link carrying a referral code: https://lumiobooking.com/<slug>?ref=CODE */
export function referralBookingUrl(slug: string | null | undefined, code: string): string {
  if (!slug) return publicWebBase();
  return `${bookingUrl(slug)}?ref=${encodeURIComponent(code)}`;
}

/** Customer-display page a paired device opens: https://lumiobooking.com/display */
export function displayBaseUrl(): string {
  return `${publicWebBase()}/display`;
}

/** One-tap pairing link (also the QR target): https://lumiobooking.com/display?c=CODE */
export function displayPairUrl(pairCode: string): string {
  return `${displayBaseUrl()}?c=${encodeURIComponent(pairCode)}`;
}

/**
 * WHERE OAUTH SENDS THE USER BACK — which is NOT the same question as
 * "where does the API live", and learning that cost a day.
 *
 * Every provider (Google, Meta, TikTok, Pinterest, Zalo) stores a redirect URI
 * as an EXACT STRING and refuses anything else, character for character. So
 * this address is not ours to choose freely: it is whatever was registered in
 * five different consoles, sometimes years ago.
 *
 * `PUBLIC_API_URL` was introduced so Twilio's voice webhooks could reach the
 * branded host. It was read by the same helper that builds OAuth redirects, so
 * setting it silently moved every redirect to an address no provider had ever
 * been told about — and every Connect button on the platform began answering
 * `redirect_uri_mismatch` (Google) and `URL Blocked` (Meta). The API had not
 * moved; only the sentence it said about itself had.
 *
 * The order below is chosen so that doing nothing restores exactly what worked:
 *
 *   1. OAUTH_BASE_URL   — set this ONLY after the new address is registered
 *                         with every provider. This is the migration switch.
 *   2. RENDER_EXTERNAL_URL — what the redirects resolved to before
 *                         PUBLIC_API_URL existed, i.e. what IS registered.
 *   3. PUBLIC_API_URL / the fallback — local dev and anywhere off Render.
 *
 * The consequence to keep in mind: with nothing set, OAuth is pinned to the
 * Render hostname, so renaming the Render service breaks every Connect button
 * until the consoles are updated. That is a real cost, and a smaller one than
 * a day of every integration being down.
 */
export function oauthBase(): string {
  const chosen = process.env.OAUTH_BASE_URL
    || process.env.RENDER_EXTERNAL_URL
    || process.env.PUBLIC_API_URL
    || 'https://lumio-api-uqm6.onrender.com';
  return chosen.replace(/\/+$/, '');
}
