/** Canonical device the customer booked on, for reporting. */
export type CanonicalDevice = 'mobile' | 'web' | 'unknown';
export const CANONICAL_DEVICES: CanonicalDevice[] = ['mobile', 'web', 'unknown'];
export function normalizeDevice(d?: string | null): CanonicalDevice {
  const v = (d ?? '').trim().toLowerCase();
  if (v === 'mobile' || v === 'phone') return 'mobile';
  if (v === 'web' || v === 'desktop' || v === 'computer') return 'web';
  return 'unknown';
}

/** Canonical customer/sale channels used across reporting. */
export type CanonicalSource = 'website' | 'lumiolink' | 'online' | 'hotline' | 'messenger' | 'walkin' | 'staff';
// Order = how they appear in reports. 'online' is a catch-all for legacy rows
// booked before we distinguished the website plugin from the hosted Lumio link.
export const CANONICAL_SOURCES: CanonicalSource[] = ['website', 'lumiolink', 'online', 'hotline', 'messenger', 'walkin', 'staff'];

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
  if (v === 'plugin' || v === 'website' || v === 'wordpress') return 'website';
  if (v === 'hosted' || v === 'lumiolink' || v === 'link') return 'lumiolink';
  return 'online'; // web, mobile, online, or unknown legacy booked source
}
