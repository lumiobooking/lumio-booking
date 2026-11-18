/**
 * THE ADDRESS AND PHONE A SALON'S BOOKING PAGE SHOWS, when the salon never
 * typed them in Settings.
 *
 * Google's review of the "Book online" button opens each salon's page and
 * expects the store's address at the top (14/11/2026: the first review failed
 * because four salons had left the address box empty; 18/11: a fifth, added
 * to the feed after that fix, had the same gap on the eve of the production
 * review). The feed already sends the address of the salon's OWN Google
 * Business Profile, so the page falls back to that same record — the salon's
 * own listing, cached under its own tenant — instead of showing nothing.
 * What the salon typed always wins.
 */

export interface ListingAddress { street?: string | null; locality?: string | null; region?: string | null; postalCode?: string | null; country?: string | null }

/** One line, the way an address is written on a storefront page. '' when there is nothing usable. */
export function listingAddressLine(a: ListingAddress | null | undefined): string {
  if (!a || typeof a !== 'object') return '';
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const street = clean(a.street), city = clean(a.locality);
  if (!street || !city) return ''; // half an address misleads more than none
  const tail = [clean(a.region), clean(a.postalCode)].filter(Boolean).join(' ');
  return [street, city, tail].filter(Boolean).join(', ').slice(0, 200);
}

/** What the page shows: the salon's own entry first, its own Google listing second. */
export function pageContact(typed: { address?: string | null; phone?: string | null }, listing: { address?: ListingAddress | null; phone?: string | null } | null | undefined): { address: string | null; phone: string | null } {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const phone = t(typed.phone) || (/^\+?[\d\s().-]{7,20}$/.test(t(listing?.phone)) ? t(listing?.phone) : '');
  return { address: t(typed.address) || listingAddressLine(listing?.address) || null, phone: phone || null };
}
