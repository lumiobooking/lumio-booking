/**
 * The Google Business Profile campaign, and where it comes from.
 *
 * THE BUG THIS REPLACES
 *
 * The /gbp short link was supposed to stamp its own campaign onto the URL, with
 * an inline <script> in the booking layout that called history.replaceState
 * before any tag ran. The script was in the page — it could be found in the DOM
 * — and it never once executed: React inserts nested-layout markup rather than
 * the browser parsing it, and an inserted <script> element does not run.
 *
 * So every customer who tapped "Book online" on Google Maps arrived at a URL
 * with no utm at all. `bookingChannel` saw a hosted-link booking carrying no
 * campaign and filed it, correctly by its own rules, as "Lumio link". Months of
 * Google Maps bookings — for most salons the largest source of new customers —
 * were invisible to the engine that decides where the advertising money goes,
 * and the salon had no way to know Google was working.
 *
 * WHY THE PATH IS NOW THE EVIDENCE
 *
 * Because the path cannot be lost. A query string can be stripped by a redirect,
 * dropped by a PWA relaunch, or never written at all — which is exactly what
 * happened. `/gbp` is the route the customer actually asked for, it is in
 * `location.pathname`, and nothing between Google and the booking form rewrites
 * it. Attribution that depends on a URL parameter surviving four hops is
 * attribution that will go quiet again; this cannot.
 */

export const GBP_CAMPAIGN = {
  utmSource: 'google',
  utmMedium: 'organic',
  utmCampaign: 'gbp_booking',
  utmContent: 'booking_button',
} as const;

/** True when this page was opened through the Google Business Profile link. */
export function isGbpPath(pathname: string | null | undefined): boolean {
  return /\/gbp\/?$/.test(String(pathname ?? ''));
}

/**
 * The campaign to record for this booking.
 *
 * A utm already on the URL WINS. Someone who built a tracked link by hand meant
 * it, and overwriting their campaign with ours would make the /gbp route lie
 * about a booking it merely happened to serve.
 */
export function gbpAttribution(
  pathname: string | null | undefined,
  current: { utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string },
): { utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string } {
  if (!isGbpPath(pathname) || current.utmSource) return current;
  return { ...GBP_CAMPAIGN, ...Object.fromEntries(Object.entries(current).filter(([, v]) => Boolean(v))) };
}

/** The query string the /gbp page should show, so analytics tags see it too. */
export function gbpSearch(search: string): string | null {
  if (search.includes('utm_campaign=')) return null; // already carries a campaign
  const q = new URLSearchParams(search);
  q.set('utm_source', GBP_CAMPAIGN.utmSource);
  q.set('utm_medium', GBP_CAMPAIGN.utmMedium);
  q.set('utm_campaign', GBP_CAMPAIGN.utmCampaign);
  q.set('utm_content', GBP_CAMPAIGN.utmContent);
  return `?${q.toString()}`;
}
