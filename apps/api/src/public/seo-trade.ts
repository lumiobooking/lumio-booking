/**
 * WHAT TRADE THE BOOKING LINK ADVERTISES — for the title and description a
 * link preview shows (Facebook, Messenger, Zalo, iMessage, Google).
 *
 * The booking page said "Book a Nail Appointment Online" for every tenant that
 * was not a RESTAURANT: hair salons, massage spas, and cafés registered as
 * SERVICE all sent their customers a nail-salon preview. The trade is now
 * read, in this order:
 *   1. the owner's own choice of industry (setting `industry`), when it is a
 *      specific trade (not the "never chose" default for the type);
 *   2. the shop's own data — its name and the services it sells — through the
 *      same detector the content engine uses (content/industry-detect.ts),
 *      accepted only when it is clear and in the same family as the type
 *      (a SALON is never called a café, a RESTAURANT never a nail salon);
 *   3. otherwise the plain family word: "appointment", "table", "online".
 * "Nail" is said only when something says nail. Pure.
 */
import { detectIndustry } from '../content/industry-detect';
import { INDUSTRY_KEY, industryDef } from '../common/industry';

export { INDUSTRY_KEY };

/** What the web page needs: a trade it has words for. */
export type SeoTrade =
  | 'NAIL' | 'HAIR' | 'LASH' | 'SPA' | 'MASSAGE' | 'DENTAL' | 'BEAUTY'
  | 'RESTAURANT' | 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD'
  | 'REAL_ESTATE' | 'SERVICE';

const FOOD = new Set(['RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD']);
const BEAUTY = new Set(['NAIL', 'HAIR', 'LASH', 'SPA', 'MASSAGE']);

export function seoTrade(input: {
  businessType: string | null | undefined;
  /** The stored `industry` setting value (or null when never chosen). */
  storedIndustry: unknown;
  tenantName?: string | null;
  serviceNames?: (string | null | undefined)[];
  website?: string | null;
}): SeoTrade {
  const type = String(input.businessType ?? 'SALON').toUpperCase();
  if (type === 'REAL_ESTATE') return 'REAL_ESTATE';

  // 1. The owner's choice, when it names a specific trade of this type.
  const key = String((input.storedIndustry as { key?: string } | null)?.key ?? input.storedIndustry ?? '').toUpperCase();
  const def = key ? industryDef(key) : undefined;
  if (def && def.businessType === type && key !== 'SERVICE' && key !== 'RESTAURANT') {
    if (key === 'DENTAL' || BEAUTY.has(key) || FOOD.has(key)) return key as SeoTrade;
  }

  // 2. The shop's own words, inside its own family only.
  const d = detectIndustry({ tenantName: input.tenantName, serviceNames: input.serviceNames, website: input.website, currentIndustry: type });
  const clear = d.confidence === 'high';
  const t = d.trade ? String(d.trade).toUpperCase() : null;
  if (type === 'SALON') {
    if (clear && d.detected === 'SALON' && t && BEAUTY.has(t)) return t as SeoTrade;
    return 'BEAUTY';
  }
  if (type === 'RESTAURANT') {
    if (clear && d.detected === 'RESTAURANT' && t && FOOD.has(t)) return t as SeoTrade;
    return 'RESTAURANT';
  }
  // SERVICE: whatever it is, it books appointments — never a table, never nails.
  return 'SERVICE';
}
