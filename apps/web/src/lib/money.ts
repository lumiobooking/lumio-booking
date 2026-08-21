/**
 * How money is written, in one place.
 *
 * Split out of ui.ts so it can be tested: ui.ts also carries React style
 * objects, and the rules below are the ones that were wrong for a whole
 * currency and must never be wrong again.
 */
import { uiLocale } from './datetime';

/** Intl throws on a blank or malformed code, and a page must never white-screen
 *  over a missing currency setting. */
const safeFormatter = (currency: string, locale: string): Intl.NumberFormat => {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency });
  } catch {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  }
};

export const minorUnitDigits = (currency: string): number =>
  safeFormatter(currency, 'en-US').resolvedOptions().maximumFractionDigits ?? 2;

export function formatPrice(minorUnits: number, currency = 'USD'): string {
  // Grouping and symbol placement belong to the locale, not the currency: the
  // amount was right after the decimals were fixed, but a Vietnamese salon was
  // still reading "₫200,000" — American separators, symbol on the American
  // side — where the country writes "200.000 ₫". uiLocale() is the same signal
  // the dates already follow, so the dashboard agrees with itself.
  const nf = safeFormatter(currency, uiLocale());
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  return nf.format(digits === 0 ? minorUnits : minorUnits / 10 ** digits);
}

/** True when the currency has no sub-unit, so inputs are whole units and no
 *  "cents" box should ever be shown. */
export function isZeroDecimalCurrency(currency = 'USD'): boolean {
  return minorUnitDigits(currency) === 0;
}

/**
 * What the owner TYPED into a price box, as the integer we store.
 *
 * Every price box in the dashboard was doing `Math.round(value * 100)`, which
 * is the dollar's rule stated as if it were arithmetic. The đồng has no
 * subunit: 200,000₫ is stored as 200000, so multiplying turns a two-hundred-
 * thousand đồng service into twenty million. The display was fixed weeks ago;
 * the INPUT never was, which meant a Vietnamese salon could not enter a
 * correct price at all — the number was wrong the moment it was saved.
 *
 * Dollars and Canadian dollars still multiply by 100, so nothing an existing
 * salon has typed or will type changes by a cent.
 */
export function toMinorUnits(input: string | number, currency = 'USD'): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  const digits = minorUnitDigits(currency);
  return Math.round(n * 10 ** digits);
}

/**
 * The stored integer, as text to put back INTO a price box.
 *
 * The inverse of toMinorUnits, and it has to be exact: this is what the owner
 * sees when they reopen a service to edit it. A currency with no subunit shows
 * the whole number and no trailing ".00" that a person would then have to
 * delete.
 */
/**
 * The `step` a price box should use.
 *
 * A number input stepping by 0.01 is right for dollars and absurd for đồng,
 * where the arrow keys would nudge a 200,000₫ price by a hundredth of a
 * hundredth of the amount. Whole-unit currencies step by 1,000 — roughly the
 * smallest change anyone actually makes to a price in Vietnam.
 */
export function priceInputStep(currency = 'USD'): string {
  return isZeroDecimalCurrency(currency) ? '1000' : '0.01';
}

export function fromMinorUnits(minorUnits: number, currency = 'USD'): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(Math.round(minorUnits || 0));
  return ((minorUnits || 0) / 10 ** digits).toFixed(digits);
}

/**
 * The symbol a currency is written with: USD -> $, VND -> ₫.
 *
 * Used for money-entry LABELS ("Cash received ₫"), not for amounts — amounts go
 * through formatPrice, which handles grouping and decimals too. It exists
 * because thirteen labels had a dollar sign typed straight into them, in both
 * the English and the Vietnamese translations, so a salon in Hanoi counting
 * dong was asked for dollars at its own till.
 *
 * Falls back to the currency code rather than to '$': a wrong symbol on a
 * money field is worse than an unfamiliar one, because the symbol is what tells
 * the owner what scale to type in.
 */
export function currencySymbolFor(currency = 'USD'): string {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
