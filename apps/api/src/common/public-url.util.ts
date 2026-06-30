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
