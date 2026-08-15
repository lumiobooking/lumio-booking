import type { CSSProperties } from 'react';
import { uiLocale } from './datetime';

// Shared style tokens for the dashboard pages.
export const ui = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: 20,
  } as CSSProperties,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #475569',
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: 14,
    colorScheme: 'dark',
  } as CSSProperties,
  primaryBtn: {
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: 'white',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  dangerBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #ef4444',
    background: 'transparent',
    color: '#ef4444',
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  th: { padding: '12px 14px', fontWeight: 600, color: '#cbd5e1', textAlign: 'left', whiteSpace: 'nowrap' } as CSSProperties,
  td: { padding: '12px 14px' } as CSSProperties,
  banner: {
    background: '#7f1d1d',
    color: '#fecaca',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    margin: '12px 0',
  } as CSSProperties,
  label: { display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 6 } as CSSProperties,
};

/**
 * Money is stored in a currency's SMALLEST unit. For USD/CAD that is cents, so
 * 12345 → $123.45. For currencies with no sub-unit — the đồng, the yen, the won
 * — the smallest unit IS the currency, so 250000 must render as ₫250,000 and
 * NOT be divided at all. Dividing anyway showed a 250.000 ₫ gel set to the
 * customer as 2.500 ₫: a hundredth of the price, on the page they book from.
 *
 * How many decimals a currency has comes from Intl itself rather than a list we
 * would have to maintain. USD and CAD resolve to 2 and still divide by 100, so
 * every existing US/CA salon renders byte-for-byte what it rendered before.
 */
/** Intl throws on a blank or malformed code, and a page must never white-screen
 *  over a missing currency setting. */
const safeFormatter = (currency: string, locale: string): Intl.NumberFormat => {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency });
  } catch {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  }
};

const minorUnitDigits = (currency: string): number =>
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
