/** Canonical customer/sale channels used across reporting. */
export type CanonicalSource = 'online' | 'hotline' | 'messenger' | 'walkin' | 'staff';
export const CANONICAL_SOURCES: CanonicalSource[] = ['online', 'hotline', 'messenger', 'walkin', 'staff'];

/**
 * Map any raw source value (Appointment.source, Order.source) to a canonical
 * channel. Web + mobile booking → online; admin/manual → staff; anything
 * unrecognized → online (a booked appointment). Callers that know a sale is a
 * walk-in / counter sale should pass 'walkin' or default to it explicitly.
 */
export function normalizeSource(s?: string | null): CanonicalSource {
  const v = (s ?? '').trim().toLowerCase();
  if (v === 'walkin' || v === 'walk-in' || v === 'retail' || v === 'counter') return 'walkin';
  if (v === 'hotline' || v === 'voice' || v === 'call' || v === 'phone') return 'hotline';
  if (v === 'messenger' || v === 'facebook' || v === 'fb' || v === 'chat') return 'messenger';
  if (v === 'admin' || v === 'staff' || v === 'manual') return 'staff';
  return 'online'; // web, mobile, online, or unknown booked source
}
