/**
 * Derives WHERE a booking was acquired from, strictly from first-party data
 * stored on the appointment. Kept separate from `booking_surface` (hosted vs
 * website_embed — the `source` column): surface says WHERE the form ran,
 * acquisition says WHAT brought the customer.
 *
 * Precedence (most reliable proof first):
 *   1. Google click id (gclid/gbraid/wbraid)          -> google_ads
 *   2. GBP campaign (utm_campaign=gbp_booking; legacy
 *      medium=gbp / campaign=business_profile kept so
 *      links already pasted into Google keep counting) -> google_maps_organic
 *   3. Form embedded on the salon's own website        -> website
 *   4. External referrer                               -> referral
 *   5. Nothing at all                                  -> direct
 */
export type AcquisitionSource = 'google_ads' | 'google_maps_organic' | 'website' | 'referral' | 'direct' | 'unknown';

export interface AcquisitionInput {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  attrReferrer?: string | null;
  /** Appointment.source — booking surface / channel as recorded at create time. */
  source?: string | null;
}

const EMBED_SURFACES = new Set(['plugin', 'website']);

export function deriveAcquisition(a: AcquisitionInput): AcquisitionSource {
  const lc = (v?: string | null) => (v || '').trim().toLowerCase();
  if (lc(a.gclid) || lc(a.gbraid) || lc(a.wbraid)) return 'google_ads';
  const campaign = lc(a.utmCampaign);
  const src = lc(a.utmSource);
  const medium = lc(a.utmMedium);
  if (campaign === 'gbp_booking') return 'google_maps_organic';
  if (src === 'google' && medium === 'gbp') return 'google_maps_organic'; // legacy stamped link
  if (src === 'google' && campaign === 'business_profile') return 'google_maps_organic'; // legacy v2
  if (EMBED_SURFACES.has(lc(a.source))) return 'website';
  if (src || medium || campaign) return 'referral'; // some OTHER tagged campaign
  const ref = lc(a.attrReferrer);
  if (ref && !ref.includes('lumiobooking.com')) return 'referral';
  if (a.source != null || a.utmSource !== undefined) return 'direct';
  return 'unknown';
}
