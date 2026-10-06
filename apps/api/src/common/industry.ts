/**
 * WHICH LINE OF BUSINESS A TENANT IS IN — the finer answer the UI needs.
 *
 * Lumio started as nail-salon software and every screen still says so:
 * "thợ", "tiệm", "lịch hẹn". A dental clinic, a lash studio, a restaurant or
 * a real-estate office reads the same words, which is wrong for all of them.
 *
 * `businessType` (the database enum) has four coarse values and drives the
 * booking backbone (restaurant tables, the AI persona). An INDUSTRY is the
 * finer label the owner recognises — Nail, Mi, Tóc, Spa, Massage, Nha khoa,
 * Nhà hàng, Quán ăn, Cà phê, Bất động sản, Dịch vụ khác — and it decides the
 * words and the menu the salon's own screens show. Each industry maps to
 * exactly one businessType, so choosing one keeps the two in step.
 *
 * Stored per tenant in settings (key `industry`): no migration, and a tenant
 * that never chose keeps NAIL (for SALON) — exactly the screens it has today.
 */

export type BusinessTypeKey = 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE';

export const INDUSTRY_KEY = 'industry';

export interface IndustryDef {
  key: string;
  businessType: BusinessTypeKey;
  vi: string;
  en: string;
  group: 'beauty' | 'health' | 'food' | 'other';
  /** The content engine's trade code, when it has one (see trends/trend-feed). */
  trade: string;
}

export const INDUSTRIES: IndustryDef[] = [
  { key: 'NAIL', businessType: 'SALON', vi: 'Nail', en: 'Nail salon', group: 'beauty', trade: 'NAIL' },
  { key: 'LASH', businessType: 'SALON', vi: 'Mi / Chân mày', en: 'Lash & brow', group: 'beauty', trade: 'LASH' },
  { key: 'HAIR', businessType: 'SALON', vi: 'Tóc', en: 'Hair salon', group: 'beauty', trade: 'HAIR' },
  { key: 'SPA', businessType: 'SALON', vi: 'Spa', en: 'Spa', group: 'beauty', trade: 'SPA' },
  { key: 'MASSAGE', businessType: 'SALON', vi: 'Massage', en: 'Massage', group: 'beauty', trade: 'MASSAGE' },
  { key: 'DENTAL', businessType: 'SERVICE', vi: 'Nha khoa / Phòng khám', en: 'Dental / Clinic', group: 'health', trade: 'DENTAL' },
  { key: 'RESTAURANT', businessType: 'RESTAURANT', vi: 'Nhà hàng', en: 'Restaurant', group: 'food', trade: 'RESTAURANT' },
  { key: 'FAST_FOOD', businessType: 'RESTAURANT', vi: 'Quán ăn', en: 'Eatery / Takeaway', group: 'food', trade: 'FAST_FOOD' },
  { key: 'CAFE', businessType: 'RESTAURANT', vi: 'Cà phê', en: 'Café', group: 'food', trade: 'CAFE' },
  { key: 'REAL_ESTATE', businessType: 'REAL_ESTATE', vi: 'Bất động sản', en: 'Real estate', group: 'other', trade: 'REAL_ESTATE' },
  { key: 'SERVICE', businessType: 'SERVICE', vi: 'Dịch vụ khác', en: 'Other services', group: 'other', trade: 'SERVICE' },
];

const BY_KEY = new Map(INDUSTRIES.map((i) => [i.key, i]));

/** The industry a tenant shows when it never chose one: today's screens, unchanged. */
export function defaultIndustryFor(businessType: string | null | undefined): string {
  switch (String(businessType ?? '').toUpperCase()) {
    case 'RESTAURANT': return 'RESTAURANT';
    case 'REAL_ESTATE': return 'REAL_ESTATE';
    case 'SERVICE': return 'SERVICE';
    default: return 'NAIL';
  }
}

export function isIndustry(key: unknown): key is string {
  return typeof key === 'string' && BY_KEY.has(key.toUpperCase());
}

export function industryDef(key: string): IndustryDef | undefined {
  return BY_KEY.get(String(key ?? '').toUpperCase());
}

/**
 * What a tenant is: the stored choice when it is valid AND still agrees with
 * the database's businessType (someone may have changed the type alone in an
 * older screen), otherwise the default for its type.
 */
export function resolveIndustry(stored: unknown, businessType: string | null | undefined): string {
  const key = String((stored as { key?: string } | null)?.key ?? stored ?? '').toUpperCase();
  const def = BY_KEY.get(key);
  if (def && def.businessType === String(businessType ?? 'SALON').toUpperCase()) return def.key;
  return defaultIndustryFor(businessType);
}

type Tx = {
  tenant: { update: (a: unknown) => Promise<unknown> };
  setting: {
    findUnique: (a: unknown) => Promise<{ value: unknown } | null>;
    upsert: (a: unknown) => Promise<unknown>;
  };
  service?: { count: (a: unknown) => Promise<number>; create: (a: unknown) => Promise<unknown> };
};

/**
 * Put ONE tenant in an industry: the setting, the matching businessType, and
 * the content engine's trade (marked as a person's decision, so the profile
 * scan leaves it alone). Every write names the tenantId it was given — the
 * caller has already proved the right to touch that tenant.
 */
export async function writeIndustry(db: Tx, tenantId: string, key: string): Promise<IndustryDef> {
  const def = industryDef(key);
  if (!def) throw new Error(`Unknown industry: ${key}`);
  await db.setting.upsert({
    where: { tenantId_key: { tenantId, key: INDUSTRY_KEY } },
    update: { value: { key: def.key } },
    create: { tenantId, key: INDUSTRY_KEY, value: { key: def.key } },
  });
  await db.tenant.update({ where: { id: tenantId }, data: { businessType: def.businessType } });
  const prof = await db.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'business_profile' } } }).catch(() => null);
  const cur = (prof?.value && typeof prof.value === 'object' ? prof.value : {}) as Record<string, unknown>;
  await db.setting.upsert({
    where: { tenantId_key: { tenantId, key: 'business_profile' } },
    update: { value: { ...cur, trade: def.trade, tradeSource: 'manual' } },
    create: { tenantId, key: 'business_profile', value: { ...cur, trade: def.trade, tradeSource: 'manual' } },
  });
  // The booking core needs at least one bookable service. A restaurant or an
  // office that has none yet gets a sensible first one (same as Super Admin).
  if (db.service && (def.businessType === 'RESTAURANT' || def.businessType === 'REAL_ESTATE')) {
    const n = await db.service.count({ where: { tenantId } }).catch(() => 1);
    if (n === 0) {
      await db.service.create({
        data: def.businessType === 'RESTAURANT'
          ? { tenantId, name: 'Table reservation', durationMinutes: 90, priceCents: 0, currency: 'USD', isActive: true }
          : { tenantId, name: 'Consultation call', durationMinutes: 30, priceCents: 0, currency: 'USD', isActive: true },
      }).catch(() => undefined);
    }
  }
  return def;
}
