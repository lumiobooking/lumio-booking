/**
 * /{slug}/gbp — the SHORT Google Business Profile link.
 *
 * Renders the EXACT same booking page (same component, same flow, no redirect).
 * What makes it special is only the path: before any analytics tag runs, the
 * shared layout rewrites the URL (history.replaceState) to carry
 * utm_source=google&utm_medium=organic&utm_campaign=gbp_booking&utm_content=booking_button,
 * so GA4/GTM record the page_view with the Google Maps campaign AND the booking
 * flow stores the same attribution on the appointment. The plain /{slug} link
 * is untouched — only this route claims the Google Maps source.
 */
export { default } from '../page';
