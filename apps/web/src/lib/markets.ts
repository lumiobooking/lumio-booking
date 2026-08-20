/**
 * Markets, for display only.
 *
 * Deliberately just the label, the flag and the default timezone. Everything a
 * market actually MEANS — currency, decimals, country, tipping — is decided on
 * the server in apps/api/src/common/markets.ts and applied when the salon is
 * created. Duplicating those values here would give two places to disagree
 * about what a Vietnamese salon's currency is, and one of them would eventually
 * be wrong.
 *
 * The timezone is here for one reason: it prefills the picker on the create
 * form so the operator sees what they are about to get, and can change it
 * before submitting. The server still decides if the field is left alone.
 */
export interface MarketOption {
  code: string;
  label: string;
  flag: string;
  /** Prefill only — the server owns the real default. */
  timezone: string;
}

export const MARKET_OPTIONS: MarketOption[] = [
  { code: 'US', label: 'US / Canada', flag: '🇺🇸', timezone: 'America/New_York' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦', timezone: 'America/Toronto' },
  { code: 'VN', label: 'Việt Nam', flag: '🇻🇳', timezone: 'Asia/Ho_Chi_Minh' },
];

/** Unknown or missing is US — the market every existing salon is in. */
export function marketOption(code: string | null | undefined): MarketOption {
  const key = String(code ?? '').trim().toUpperCase();
  return MARKET_OPTIONS.find((m) => m.code === key) ?? MARKET_OPTIONS[0];
}

/** Short label for a table row: "🇻🇳 VN". */
export function marketTag(code: string | null | undefined): string {
  const m = marketOption(code);
  return `${m.flag} ${m.code}`;
}

/**
 * The language a salon should open in when its owner has never chosen one.
 *
 * A Vietnamese owner signing in for the first time should not have to find a
 * language menu written in English. But a stored choice always wins: someone
 * who deliberately switched to English is not overruled on every page load,
 * and a US salon is never touched because 'US' returns null.
 *
 * Returns null when there is nothing to do, so the caller can skip the write.
 * Lives here rather than in i18n.tsx because it is pure logic about markets —
 * and because a module with JSX in it cannot be imported by a plain test.
 */
export function defaultLangForMarket(
  market: string | null | undefined,
  stored: string | null | undefined,
): 'vi' | 'en' | null {
  if (stored === 'vi' || stored === 'en') return null; // they have chosen
  return String(market ?? '').trim().toUpperCase() === 'VN' ? 'vi' : null;
}
