/**
 * Turning a stored amount into words a customer reads.
 *
 * The server had been doing this in a dozen places, each one written as
 * `cents / 100` with a `$` in front. That is right for the dollar and wrong for
 * the đồng, which has no subunit at all: a 200,000₫ service is STORED as
 * 200000 and dividing it prints ₫2,000 — the customer is quoted a hundredth of
 * the real price, in a confirmation text, by the booking bot, and by the phone
 * assistant. It is the same bug three times because the formatting was three
 * times copied.
 *
 * So there is one function now, and it asks the currency how many decimals it
 * actually has instead of assuming two.
 *
 * The web app has its own copy in apps/web/src/lib/ui.ts. They are deliberately
 * not shared: this one runs in Node with no browser locale, and the two apps
 * ship separately. They agree on the rule, which is what matters.
 */

/** A formatter for `currency`, falling back to USD if the code is nonsense. */
function safeFormatter(currency: string, locale: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency });
  } catch {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  }
}

/**
 * How many decimal places this currency really has.
 *
 * USD and CAD answer 2, VND and JPY answer 0. Asking Intl means we never have
 * to keep our own list of currencies up to date, and never have to guess.
 */
export function minorUnitDigits(currency = 'USD'): number {
  return safeFormatter(currency, 'en-US').resolvedOptions().maximumFractionDigits ?? 2;
}

/** True when the currency has no subunit, so the stored number IS the amount. */
export function isZeroDecimalCurrency(currency = 'USD'): boolean {
  return minorUnitDigits(currency) === 0;
}

/**
 * Format a stored amount for a human.
 *
 * `minorUnits` is what the database holds: cents for the dollar, whole đồng for
 * Vietnam. A zero-decimal currency is therefore NOT divided — that division is
 * the entire bug this function exists to end.
 *
 * `locale` decides grouping and symbol placement: en-US gives "$55.00",
 * vi-VN gives "200.000 ₫". Left alone it behaves exactly as the old code did.
 */
export function formatMoney(minorUnits: number, currency = 'USD', locale = 'en-US'): string {
  const nf = safeFormatter(currency, locale);
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  return nf.format(digits === 0 ? Math.round(minorUnits) : minorUnits / 10 ** digits);
}

/**
 * A short price for a list a bot reads aloud or pastes into a chat.
 *
 * Whole amounts drop their decimals ("$55", not "$55.00") because that is how
 * a person says a price, but a price with real cents keeps them — "$54.50"
 * must not become "$55", which is a different number and a broken promise.
 */
export function formatMoneyShort(minorUnits: number, currency = 'USD', locale = 'en-US'): string {
  const digits = minorUnitDigits(currency);
  const isWhole = digits === 0 || minorUnits % 10 ** digits === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: isWhole ? 0 : digits,
      maximumFractionDigits: isWhole ? 0 : digits,
    }).format(digits === 0 ? Math.round(minorUnits) : minorUnits / 10 ** digits);
  } catch {
    return formatMoney(minorUnits, currency, locale);
  }
}

/**
 * Which locale a salon's OWN customers should be written to.
 *
 * A confirmation text is read by the customer, not by us, so it follows the
 * salon's country the way the booking page does. Anything we do not recognise
 * answers en-US, which is what every salon running today already gets.
 */
export function localeForCountry(country?: string | null, timezone?: string | null): string {
  const c = String(country || '').trim().toUpperCase();
  if (c === 'VN') return 'vi-VN';
  if (c) return 'en-US';
  const tz = String(timezone || '');
  return tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon' ? 'vi-VN' : 'en-US';
}
