/**
 * What a market is, in one place.
 *
 * A "market" is not a separate system. It is a property of a salon, exactly
 * like its timezone or its plan — one column on the tenant row. The isolation
 * that keeps salons apart is the one this platform has always had: tenant_id on
 * every table, every query scoped to the authenticated tenant. A Vietnamese
 * salon is simply another tenant. It cannot see a US salon for the same reason
 * no US salon can see another US salon.
 *
 * WHY THIS FILE EXISTS
 *
 * The facts a market implies were scattered across three storage locations and
 * two apps: timezone on the tenant row, country inside a `company_extra`
 * setting, currency inside `booking_rules`, tips inside `pos_settings`, and a
 * COUNTRY_PRESETS table living only in the web salon settings page. So opening
 * a Vietnamese salon meant creating it, then hunting through settings screens
 * to correct four things — and getting any of them wrong is expensive. The
 * wrong timezone books people at the wrong hour. The wrong currency quotes the
 * wrong price. A missing decimals=0 turned 200.000₫ into ₫2.000.
 *
 * Now it is one choice at creation, and this file is what that choice means.
 *
 * THE RULE THAT PROTECTS EVERY EXISTING SALON
 *
 * `US` must be byte-for-byte what the system already did with no market set.
 * Every salon on the platform today is US by default, so if the US preset ever
 * drifts from the old defaults, it silently rewrites live salons. There is a
 * test asserting each field against the shipped defaults; treat a failure there
 * as "this change is not safe", not as "the test needs updating".
 */

export type MarketCode = 'US' | 'CA' | 'VN';

export interface MarketDef {
  code: MarketCode;
  /** For the Super Admin dropdown. */
  label: string;
  flag: string;
  /** ISO 3166-1 alpha-2, written to the `company_extra` setting. Drives phone
   *  dial code and the date/number locale in messages sent to customers. */
  country: MarketCode;
  /** Starting timezone. The salon can change it; most never do. */
  timezone: string;
  currency: string;
  currencySymbol: string;
  symbolPosition: 'before' | 'after';
  /** 0 for VND: dong has no minor unit, and treating it as if it did is what
   *  turned a 200,000₫ manicure into ₫2,000 in customer messages. */
  priceDecimals: number;
  /** Tipping a nail tech is normal in North America and unusual in Vietnam.
   *  A starting point, not a rule — the salon can switch it back on. */
  tipsEnabled: boolean;
  /** Dashboard language the owner most likely wants on day one. */
  lang: 'en' | 'vi';
  /**
   * Feature-policy keys that make no sense here, so the Super Admin screen can
   * grey them out instead of letting someone sell a Vietnamese salon a US card
   * terminal. Nothing is enforced by this list — every feature already starts
   * hidden and is handed over one tick at a time. This only stops a mistake.
   */
  unavailableFeatures: string[];
}

export const MARKETS: Record<MarketCode, MarketDef> = {
  US: {
    code: 'US', label: 'US / Canada', flag: '🇺🇸',
    country: 'US', timezone: 'America/Los_Angeles',
    // '' means "derive from the currency code" — the shipped default. Writing
    // '$' here would be a change to every existing salon, not a preset.
    currency: 'USD', currencySymbol: '', symbolPosition: 'before', priceDecimals: 2,
    tipsEnabled: true, lang: 'en',
    unavailableFeatures: [],
  },
  CA: {
    code: 'CA', label: 'Canada', flag: '🇨🇦',
    country: 'CA', timezone: 'America/Toronto',
    currency: 'CAD', currencySymbol: '', symbolPosition: 'before', priceDecimals: 2,
    tipsEnabled: true, lang: 'en',
    unavailableFeatures: [],
  },
  VN: {
    code: 'VN', label: 'Việt Nam', flag: '🇻🇳',
    country: 'VN', timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND', currencySymbol: '₫', symbolPosition: 'after', priceDecimals: 0,
    tipsEnabled: false, lang: 'vi',
    // The phone bot answers in English on a US Twilio number, and the card
    // terminals are North American hardware. Neither is something to sell in
    // Hanoi. Messenger, reviews and marketing all work fine and stay offerable.
    unavailableFeatures: ['voiceAi', 'terminals'],
  },
};

/** The default for every salon that has never been told otherwise. */
export const DEFAULT_MARKET: MarketCode = 'US';

/** Resolve a stored value. Anything unrecognised is US — the original market. */
export function marketOf(code: string | null | undefined): MarketDef {
  const key = String(code ?? '').trim().toUpperCase();
  return MARKETS[key as MarketCode] ?? MARKETS[DEFAULT_MARKET];
}

export function isMarketCode(code: string | null | undefined): code is MarketCode {
  return String(code ?? '').trim().toUpperCase() in MARKETS;
}

/**
 * The settings a newly created salon should start with.
 *
 * Returned as plain fragments rather than written here, so the caller can merge
 * them into whatever defaults already exist and the whole thing stays testable
 * without a database.
 */
export function presetFor(code: string | null | undefined): {
  market: MarketCode;
  tenant: { timezone: string };
  companyExtra: { country: string };
  bookingRules: { currency: string; currencySymbol: string; symbolPosition: 'before' | 'after'; priceDecimals: number };
  posSettings: { tipsEnabled: boolean };
  lang: 'en' | 'vi';
} {
  const m = marketOf(code);
  return {
    market: m.code,
    tenant: { timezone: m.timezone },
    companyExtra: { country: m.country },
    bookingRules: {
      currency: m.currency,
      currencySymbol: m.currencySymbol,
      symbolPosition: m.symbolPosition,
      priceDecimals: m.priceDecimals,
    },
    posSettings: { tipsEnabled: m.tipsEnabled },
    lang: m.lang,
  };
}

/** Whether a feature-policy key is worth offering to a salon in this market. */
export function featureAvailableInMarket(code: string | null | undefined, featureKey: string): boolean {
  return !marketOf(code).unavailableFeatures.includes(featureKey);
}

/** For the Super Admin dropdown and filter, in the order they should appear. */
export function marketList(): MarketDef[] {
  return [MARKETS.US, MARKETS.CA, MARKETS.VN];
}
