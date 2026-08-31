/**
 * Where the shop is, worked out from what the shop already told us.
 *
 * WHY THIS EXISTS
 *
 * The screen was saying: "We do not know this salon's city yet — fill in the
 * city and state in Super Admin." Two things are wrong with that sentence.
 *
 * The first is that it asks the wrong person. Super Admin is our staff. A shop
 * that cannot get a regional calendar until an employee of ours types its city
 * has a location problem that no amount of the shop's own effort can fix, and
 * every new tenant starts life with the wrong answer on screen.
 *
 * The second is that it asks for something already on file. The address sits in
 * the shop's own settings. A ZIP sits next to it. The service area came back
 * from the website scan. Any one of those pins the state — the thing every
 * regional calendar actually runs on. Asking again is asking someone to re-type
 * what we are holding.
 *
 * So this walks the sources the shop controls, in order of authority, and stops
 * at the first that yields a state. It reports WHICH source answered, because a
 * location the shop can see the origin of is one the shop can correct; a bare
 * "Kerrville, TX" with no provenance is one nobody can argue with.
 *
 * When nothing answers it still refuses to guess — half-right geography is
 * worse than none — but the instruction it prints is one the shop can carry out
 * itself, in its own settings, today.
 */

import { parseAddress, stateFromZip, type Market } from './region-events';

export type LocationSource = 'tenant' | 'address' | 'serviceArea' | 'zip' | 'none';

export interface LocationInput {
  market?: string | null;
  /** Fields on the tenant record, when someone has filled them. */
  tenantCity?: string | null;
  tenantRegion?: string | null;
  tenantPostal?: string | null;
  nearbyZips?: string | null;
  /** The address in the shop's own settings (Cài đặt tiệm → thông tin công ty). */
  address?: string | null;
  /** Service area from the business profile — typed, or learned by the scan. */
  serviceArea?: string | null;
}

export interface ResolvedShopLocation {
  city: string | null;
  region: string | null;
  postalCode: string | null;
  source: LocationSource;
  /** Vietnamese, for the screen: where this came from. Null when nothing did. */
  sourceLabel: string | null;
  /** What the SHOP can do about it. Null once the location is known. */
  fix: string | null;
}

const clean = (s: string | null | undefined) => {
  const v = String(s ?? '').trim();
  return v || null;
};

/** The first five-digit ZIP in a comma-separated list. */
const firstZip = (s: string | null | undefined): string | null => {
  const m = /\b(\d{5})\b/.exec(String(s ?? ''));
  return m ? m[1] : null;
};

export function resolveShopLocation(i: LocationInput): ResolvedShopLocation {
  const market: Market = i.market === 'VN' ? 'VN' : i.market === 'CA' ? 'CA' : 'US';
  const fromAddress = parseAddress(i.address, market);
  const fromArea = parseAddress(i.serviceArea, market);

  // Every ZIP the shop already holds, most authoritative first. The address has
  // been there since setup; asking for the ZIP separately was asking twice.
  const postalCode = firstZip(i.tenantPostal)
    ?? fromAddress.postalCode ?? fromArea.postalCode ?? firstZip(i.nearbyZips);

  const candidates: { region: string | null; city: string | null; source: LocationSource; label: string }[] = [
    {
      region: clean(i.tenantRegion)?.toUpperCase() ?? null,
      city: clean(i.tenantCity),
      source: 'tenant',
      label: 'hồ sơ tiệm',
    },
    {
      region: fromAddress.region, city: fromAddress.city,
      source: 'address', label: 'địa chỉ trong cài đặt tiệm',
    },
    {
      region: fromArea.region, city: fromArea.city,
      source: 'serviceArea', label: 'khu vực phục vụ tiệm đã khai',
    },
    {
      // Last, because a ZIP gives the state and never the city — but a state is
      // what the calendar runs on, so this is a real answer, not a fallback
      // dressed up as one.
      region: market === 'US' ? stateFromZip(postalCode) : null, city: null,
      source: 'zip', label: postalCode ? `mã ZIP ${postalCode} của tiệm` : '',
    },
  ];

  const hit = candidates.find((c) => c.region);
  if (!hit) {
    return {
      city: clean(i.tenantCity) ?? fromAddress.city ?? fromArea.city,
      region: null,
      postalCode,
      source: 'none',
      sourceLabel: null,
      // Addressed to the shop, and doable by the shop. Naming both routes
      // matters: one is typing a line, the other is a button that reads the
      // website the shop already has.
      fix: 'Thêm địa chỉ (hoặc mã ZIP) ở Cài đặt tiệm → Thông tin công ty, hoặc bấm "Quét & học tự động" để lấy từ website/fanpage của tiệm.',
    };
  }

  return {
    // A city from anywhere is better than no city, but it never overrides the
    // one that came with the state.
    city: hit.city ?? clean(i.tenantCity) ?? fromAddress.city ?? fromArea.city,
    region: hit.region,
    postalCode,
    source: hit.source,
    sourceLabel: hit.label,
    fix: null,
  };
}
