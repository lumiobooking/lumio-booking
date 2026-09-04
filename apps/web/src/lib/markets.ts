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
  /**
   * Two letters, not a country-flag emoji.
   *
   * Those are regional-indicator pairs, and Windows ships no glyphs for them —
   * Chrome there draws the two letters raw, so the dropdown read
   * "us US / Canada" and the table column read "us US". A Super Admin screen is
   * mostly used on Windows, which makes the decoration break precisely where it
   * was meant to help.
   */
  short: string;
  /** Prefill only — the server owns the real default. */
  timezone: string;
}

export const MARKET_OPTIONS: MarketOption[] = [
  { code: 'US', label: 'US / Canada', short: 'US', timezone: 'America/New_York' },
  { code: 'CA', label: 'Canada', short: 'CA', timezone: 'America/Toronto' },
  { code: 'VN', label: 'Việt Nam', short: 'VN', timezone: 'Asia/Ho_Chi_Minh' },
];

/** Unknown or missing is US — the market every existing salon is in. */
export function marketOption(code: string | null | undefined): MarketOption {
  const key = String(code ?? '').trim().toUpperCase();
  return MARKET_OPTIONS.find((m) => m.code === key) ?? MARKET_OPTIONS[0];
}

/** Short label for a table row: just the two letters. */
export function marketTag(code: string | null | undefined): string {
  return marketOption(code).short;
}

/**
 * Is this salon in Vietnam?
 *
 * WHY THIS EXISTS, AND WHY IT TAKES THE MARKET AS AN ARGUMENT
 *
 * Screens were deciding "is this Vietnamese?" by reading the COUNTRY field out
 * of the company settings — a value the salon owner picks from a dropdown to
 * set their currency format. The tenant's real market lives in a different
 * place, drives SMS routing and feature policy, and the two are only ever
 * synced when the salon is created. So a shop moved to Vietnam by support had
 * its SMS switched to the Vietnamese carrier while the screen that configures
 * that carrier stayed hidden, and a US shop whose owner idly picked "Việt Nam"
 * in the country dropdown was shown the whole Vietnamese setup, which then did
 * nothing at all.
 *
 * One answer to "what market is this", and it comes from the server. The
 * argument is the market, never the country, so a caller that reaches for the
 * wrong field is a type error rather than a silent misread.
 */
export function isVN(market: string | null | undefined): boolean {
  return String(market ?? '').trim().toUpperCase() === 'VN';
}

/** True when the salon trades in North America — the market that Twilio, the
 *  US card gateways and the Census figures were all built for. */
export function isNorthAmerica(market: string | null | undefined): boolean {
  const m = String(market ?? '').trim().toUpperCase();
  return m === 'US' || m === 'CA' || m === '';
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
