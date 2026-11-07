/**
 * What the Google partner host (NEXT_PUBLIC_RWG_LINK_HOST, e.g.
 * https://book.lumiobooking.com) serves — see ../middleware.ts.
 * Pure, so it is tested without a server.
 */

export type PartnerVerdict = { kind: 'pass' } | { kind: 'booking' } | { kind: 'redirect'; to: string };

function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(u.includes('://') ? u : `https://${u}`).host.toLowerCase(); } catch { return null; }
}

/** Real app sections that never live on the partner host. A single path segment that is not one of these is a salon slug. */
const APP_SECTIONS = new Set([
  'a', 'account-deletion', 'agency', 'api', 'appt', 'book', 'booking-policy', 'bootstrap', 'checkin', 'company', 'data-deletion', 'display',
  'f', 'google-opt-out', 'healthz', 'invoice', 'kitchen', 'login', 'merchant-terms', 'oauth', 'pay', 'pos-display', 'privacy', 'queue-tv',
  'review', 'review-posts', 'salon', 'sign', 'signup', 'sms-optin', 'staff', 'super-admin', 'support', 't', 'terms', 'tiktok', 'turns-tv',
  'unsubscribe', 'welcome',
]);

/** Paths a customer booking from Google may need on the partner host. */
const BOOKING_SECTIONS = new Set(['book', 'pay', 'appt', 'booking-policy', 'privacy', 'terms', 'merchant-terms', 'google-opt-out', 'unsubscribe']);

export function partnerHostVerdict(host: string | null | undefined, path: string, partnerUrl: string | null | undefined, mainUrl: string | null | undefined): PartnerVerdict {
  const partner = hostOf(partnerUrl);
  const here = (host ?? '').toLowerCase().split(':')[0];
  if (!partner || here !== partner.split(':')[0]) return { kind: 'pass' };
  const main = (mainUrl || 'https://lumiobooking.com').replace(/\/$/, '');
  const p = path || '/';
  // Next's own files, the app's same-origin endpoints (/api/build…), plain files.
  if (p.startsWith('/_next/') || p.startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(p) || p === '/manifest.webmanifest') return { kind: 'pass' };
  const segs = p.split('/').filter(Boolean);
  if (!segs.length) return { kind: 'redirect', to: `${main}/` };
  const first = segs[0].toLowerCase();
  if (BOOKING_SECTIONS.has(first)) return { kind: 'booking' };
  // /<salon> and /<salon>/gbp — the booking page itself.
  if (!APP_SECTIONS.has(first) && (segs.length === 1 || (segs.length === 2 && segs[1] === 'gbp'))) return { kind: 'booking' };
  return { kind: 'redirect', to: `${main}${p}` };
}
