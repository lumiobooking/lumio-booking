/**
 * Where a booking came from — the one question the owner asked to see answered
 * on every card: "nguồn từ Google Maps, Facebook, Insta, gọi điện, Messenger…
 * phải ghi đầy đủ để theo dõi."
 *
 * WHY A PURE MODULE
 *
 * Three calendar views, the booking detail sheet and a legend bar all have to
 * agree on what "this came from Instagram" means. Yesterday each view had its
 * own switch statement and its own icon set; they had already drifted (the
 * month view knew sources the day view did not). One module, one answer,
 * one test file.
 *
 * TWO LAYERS OF TRUTH
 *
 * `source` says which DOOR the booking walked through: the website plugin, the
 * Lumio link, the AI hotline, a chat thread, the front desk. `utmSource` — when
 * the door was a web page — says who sent them to that door: the Facebook ad,
 * the Google Business Profile button, the Instagram bio link. The chip shows
 * the most SPECIFIC thing known: a plugin booking with utm_source=facebook is
 * a Facebook booking to the person paying for Facebook ads.
 */

export type SourceKey =
  | 'gmap' | 'facebook' | 'instagram' | 'messenger' | 'zalo'
  | 'hotline' | 'website' | 'lumiolink' | 'walkin' | 'staff' | 'online';

export interface SourceMeta {
  key: SourceKey;
  /** Chip colour — the brand's own where one exists, so the eye can find
   *  "all the Facebook bookings" without reading a single label. */
  color: string;
  labelVi: string;
  labelEn: string;
}

export const SOURCE_META: Record<SourceKey, SourceMeta> = {
  gmap:      { key: 'gmap',      color: '#34a853', labelVi: 'Google Maps',  labelEn: 'Google Maps' },
  facebook:  { key: 'facebook',  color: '#1877f2', labelVi: 'Facebook',     labelEn: 'Facebook' },
  instagram: { key: 'instagram', color: '#e1306c', labelVi: 'Instagram',    labelEn: 'Instagram' },
  messenger: { key: 'messenger', color: '#0084ff', labelVi: 'Messenger',    labelEn: 'Messenger' },
  zalo:      { key: 'zalo',      color: '#0068ff', labelVi: 'Zalo',         labelEn: 'Zalo' },
  hotline:   { key: 'hotline',   color: '#f59e0b', labelVi: 'Gọi điện',     labelEn: 'Phone call' },
  website:   { key: 'website',   color: '#6366f1', labelVi: 'Website tiệm', labelEn: 'Website' },
  lumiolink: { key: 'lumiolink', color: '#14b8a6', labelVi: 'Link Lumio',   labelEn: 'Lumio link' },
  walkin:    { key: 'walkin',    color: '#10b981', labelVi: 'Vãng lai',     labelEn: 'Walk-in' },
  staff:     { key: 'staff',     color: '#8b5cf6', labelVi: 'Tạo tại tiệm', labelEn: 'At the salon' },
  online:    { key: 'online',    color: '#64748b', labelVi: 'Đặt online',   labelEn: 'Online' },
};

/** Legend order: paid-for channels first — they are the ones being watched. */
export const SOURCE_ORDER: SourceKey[] = [
  'gmap', 'facebook', 'instagram', 'messenger', 'zalo', 'hotline',
  'website', 'lumiolink', 'walkin', 'staff', 'online',
];

/** The referrers a utm_source can name. Checked longest-first where it
 *  matters: "ig" must not be found inside "assign". */
function refineFromUtm(utm: string): SourceKey | null {
  const v = utm.toLowerCase();
  if (/\bfb\b|facebook|fbclid/.test(v)) return 'facebook';
  if (/\big\b|instagram/.test(v)) return 'instagram';
  if (/google|gmb|gbp|maps/.test(v)) return 'gmap';
  if (/zalo/.test(v)) return 'zalo';
  return null;
}

/**
 * One booking → one chip.
 *
 * The door decides; the utm refines ONLY the anonymous web doors. A Messenger
 * booking with a stray utm stays Messenger — the thread is stronger evidence
 * than a parameter someone pasted into a link.
 */
export function srcKey(b: { source?: string | null; utmSource?: string | null }): SourceKey {
  const s = String(b?.source ?? '').trim().toLowerCase();

  if (s === 'instagram' || s === 'ig') return 'instagram';
  if (s === 'messenger' || s === 'facebook' || s === 'fb' || s === 'chat') return 'messenger';
  if (s === 'zalo') return 'zalo';
  if (s === 'hotline' || s === 'voice' || s === 'call' || s === 'phone') return 'hotline';
  if (s === 'walkin' || s === 'walk-in') return 'walkin';
  if (s === 'admin' || s === 'staff' || s === 'manual') return 'staff';
  if (s === 'gmap' || s === 'google' || s === 'gbp' || s === 'rwg' || s === 'reserve_with_google') return 'gmap';

  const utm = String(b?.utmSource ?? '').trim();
  const refined = utm ? refineFromUtm(utm) : null;

  if (s === 'plugin' || s === 'website' || s === 'wordpress') return refined ?? 'website';
  if (s === 'hosted' || s === 'lumiolink' || s === 'link') return refined ?? 'lumiolink';
  // web / mobile / online / legacy empty-string
  return refined ?? 'online';
}

export function srcMetaOf(b: { source?: string | null; utmSource?: string | null }): SourceMeta {
  return SOURCE_META[srcKey(b)];
}

/**
 * The legend's numbers: how many bookings each source brought into the range
 * on screen. Only sources that actually appear are returned — a legend listing
 * eleven zeros is a form, not information.
 */
export function sourceCounts(
  rows: Array<{ source?: string | null; utmSource?: string | null }>,
): Array<{ meta: SourceMeta; count: number }> {
  const tally = new Map<SourceKey, number>();
  for (const b of rows ?? []) {
    if (!b) continue;
    const k = srcKey(b);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return SOURCE_ORDER.filter((k) => tally.has(k)).map((k) => ({ meta: SOURCE_META[k], count: tally.get(k)! }));
}
