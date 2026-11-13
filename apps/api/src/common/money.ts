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
  // Day before month, and "$45.00" rather than "A$45.00".
  if (c === 'AU') return 'en-AU';
  if (c) return 'en-US';
  const tz = String(timezone || '');
  if (tz.startsWith('Australia/')) return 'en-AU';
  return tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon' ? 'vi-VN' : 'en-US';
}


/**
 * ONE CURRENCY PER SALON (13/11/2026, Fremantle Nail Spa)
 *
 * A salon counts in one currency: the one in its Payments settings. Each
 * service row also carries a `currency` label, and that label used to stay
 * 'USD' when the salon was switched to AUD — the menu page hid it (it shows
 * every price in the salon's currency), but a booking copied the label, so an
 * Australian client's confirmation read "USD 75.00".
 *
 * The label always follows the salon. No amount is converted: every admin
 * screen (services, extras, products) reads and writes these amounts in the
 * salon's own currency whatever the row's label says, so the label is the
 * only thing that can be out of step.
 */
export function sameMinorUnits(a?: string | null, b?: string | null): boolean {
  return minorUnitDigits(String(a || 'USD').toUpperCase()) === minorUnitDigits(String(b || 'USD').toUpperCase());
}

/** The 3-letter code to use, or null when the setting holds nothing usable. */
export function currencyCode(raw: unknown): string | null {
  const c = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * The currency a salon's money is SHOWN and BOOKED in: the salon's own. The
 * row's label is used only when the salon's settings hold no usable code.
 */
export function salonMoneyCurrency(rowCurrency: string | null | undefined, salonCurrency: unknown): string {
  return currencyCode(salonCurrency) ?? currencyCode(rowCurrency) ?? 'USD';
}

interface MoneyLook { currency: string; currencySymbol: string; symbolPosition: 'before' | 'after'; priceDecimals: number }

/**
 * What the price display becomes when the Payments form is saved.
 *
 * The symbol, its side and the decimals belong to the currency. When the
 * currency changes and the form sends the OLD symbol / decimals along
 * untouched, they are stale — "$" and 2 decimals on a đồng salon — so they
 * fall back to the new currency's own: no custom symbol (screens then use the
 * currency's), and its natural decimals. A value the owner really changed in
 * the same save is kept.
 */
export function moneyLookOnChange(
  current: Partial<MoneyLook>,
  dto: { currency?: string; currencySymbol?: string; symbolPosition?: string; priceDecimals?: number },
): MoneyLook {
  const before = currencyCode(current.currency) ?? 'USD';
  const currency = currencyCode(dto.currency) ?? before;
  let currencySymbol = dto.currencySymbol ?? current.currencySymbol ?? '';
  let symbolPosition = (dto.symbolPosition ?? current.symbolPosition ?? 'before') === 'after' ? 'after' as const : 'before' as const;
  let priceDecimals = typeof dto.priceDecimals === 'number' ? dto.priceDecimals : (current.priceDecimals ?? 2);
  if (currency !== before) {
    if (currencySymbol === (current.currencySymbol ?? '')) currencySymbol = '';
    if (!sameMinorUnits(before, currency)) {
      if (priceDecimals === (current.priceDecimals ?? 2)) priceDecimals = minorUnitDigits(currency);
      if (symbolPosition === (current.symbolPosition ?? 'before')) symbolPosition = currency === 'VND' ? 'after' : 'before';
    }
  }
  return { currency, currencySymbol, symbolPosition, priceDecimals };
}
