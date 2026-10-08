/**
 * WHICH GOOGLE LOCATION BELONGS TO WHICH SALON — pure.
 *
 * The agency connects every salon's Google with ONE agency login that manages
 * dozens of Business Profiles. The old auto-detect took "the first location of
 * the first account" right after the OAuth callback — so a salon connected
 * through the agency login was silently tied to whichever profile Google
 * listed first. That is how "Vườn Tùng Nhật Bản AKITA" (a bonsai garden)
 * printed "spa 1 nails / nail salon near me" as ITS search keywords: the
 * numbers, the reviews and the keywords were another business's.
 *
 * Rules here:
 *  - A location already linked to another salon is never picked again.
 *  - Auto-pick only when there is no doubt: exactly one location left, or
 *    exactly one whose name matches the salon's own name. Otherwise nothing
 *    is picked and a person chooses from the list.
 *  - Name matching ignores the trade words every salon shares ("nail", "spa",
 *    "salon", "&"), so "Top Nails" does not match "Happy Nails & Spa".
 */

/** "locations/123" from "accounts/9/locations/123" or "locations/123"; '' if none. */
export function bareLocation(id: string | null | undefined): string {
  const s = String(id ?? '').trim();
  if (!s) return '';
  const i = s.indexOf('locations/');
  return i >= 0 ? s.slice(i) : `locations/${s}`;
}

/** Words that say what kind of business, not WHICH business. */
const GENERIC = new Set([
  'nail', 'nails', 'spa', 'salon', 'salons', 'and', 'the', 'at', 'of', 'by', 'beauty', 'studio', 'bar', 'lounge', 'care',
  'hair', 'lash', 'lashes', 'brow', 'brows', 'massage', 'wellness', 'day', 'pedicure', 'manicure', 'co', 'llc', 'inc',
  'shop', 'store', 'restaurant', 'cafe', 'coffee', 'tx', 'ca', 'ny', 'fl', 'usa', 'us', 'near', 'me', 'best', 'top',
  'tiem', 'tiệm', 'cửa', 'hàng', 'cua', 'hang', 'quán', 'quan', 'và', 'va',
]);

/** Distinctive words of a business name, accent-folded and lower-cased. */
export function nameTokens(name: string | null | undefined): string[] {
  const folded = String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase();
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  // Numbers stay ("5 Points", "501 Nails") — they are often the whole name.
  return [...new Set(words.filter((w) => !GENERIC.has(w) && (w.length > 1 || /\d/.test(w))))];
}

/** Do two business names share a distinctive word? (Either way round.) */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  return ta.some((w) => tb.includes(w));
}

export interface LocationLike { name: string; title: string }

export type PickResult =
  | { pick: LocationLike; why: 'only-one' | 'name-match' }
  | { pick: null; why: 'none' | 'all-taken' | 'ambiguous' };

/**
 * The location to link automatically, or null when a person must choose.
 * @param taken bare location ids already linked to OTHER salons
 */
export function pickLocation(locations: LocationLike[], salonName: string, taken: Set<string>): PickResult {
  const free = locations.filter((l) => l.name && !taken.has(bareLocation(l.name)));
  if (!locations.length) return { pick: null, why: 'none' };
  if (!free.length) return { pick: null, why: 'all-taken' };
  const byName = free.filter((l) => namesMatch(l.title, salonName));
  if (byName.length === 1) return { pick: byName[0], why: 'name-match' };
  if (free.length === 1 && locations.length === 1) return { pick: free[0], why: 'only-one' };
  return { pick: null, why: 'ambiguous' };
}

/** Bare location ids linked to salons OTHER than `tenantId`, from the googleReviews settings rows. */
export function takenLocations(rows: Array<{ tenantId: string; value: unknown }>, tenantId: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.tenantId === tenantId) continue;
    const v = (r.value && typeof r.value === 'object' ? r.value : {}) as { connected?: boolean; locationId?: string };
    if (v.connected !== true) continue;
    const loc = bareLocation(v.locationId);
    if (loc) out.add(loc);
  }
  return out;
}
