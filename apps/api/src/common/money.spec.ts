/**
 * The money rules, locked.
 *
 * Two bugs live behind these tests. The server printed every amount as
 * `cents / 100` with a hard "$", so a 200,000₫ service was quoted to the
 * customer as ₫2,000 — in the confirmation text, by the Messenger bot and by
 * the phone assistant, three copies of one assumption. And the fix for it had
 * to leave the dollar untouched to the character, because thousands of real
 * bookings are priced in it.
 *
 * So the first half of this file is not about Vietnam at all: it is the proof
 * that USD and CAD still read exactly as they always did.
 */
import { formatMoney, formatMoneyShort, isZeroDecimalCurrency, minorUnitDigits, localeForCountry } from './money';

/** What the server did before common/money.ts existed. */
const legacyFormat = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);

describe('US and Canadian salons — nothing may change', () => {
  const amounts = [0, 99, 500, 5450, 5500, 12000, 123456, 100000];

  it.each(['USD', 'CAD'])('%s renders exactly as the old code did', (currency) => {
    for (const minor of amounts) {
      expect(formatMoney(minor, currency, 'en-US')).toBe(legacyFormat(minor, currency));
    }
  });

  it('still divides by 100, because the dollar has cents', () => {
    expect(formatMoney(5500, 'USD', 'en-US')).toBe('$55.00');
    expect(formatMoney(5450, 'USD', 'en-US')).toBe('$54.50');
  });

  it('drops the decimals on a whole amount for a bot to read aloud', () => {
    expect(formatMoneyShort(5500, 'USD', 'en-US')).toBe('$55');
  });

  it('keeps real cents rather than rounding money away', () => {
    // The old bot code did toFixed(0), so a $9.99 service was quoted as "$10"
    // and a $54.50 one as "$55" — a different number, and a broken promise.
    expect(formatMoneyShort(999, 'USD', 'en-US')).toBe('$9.99');
    expect(formatMoneyShort(5450, 'USD', 'en-US')).toBe('$54.50');
  });
});

describe('currencies with no subunit', () => {
  it('knows which ones they are, without us keeping a list', () => {
    expect(isZeroDecimalCurrency('VND')).toBe(true);
    expect(isZeroDecimalCurrency('JPY')).toBe(true);
    expect(isZeroDecimalCurrency('USD')).toBe(false);
    expect(isZeroDecimalCurrency('CAD')).toBe(false);
    expect(minorUnitDigits('VND')).toBe(0);
    expect(minorUnitDigits('USD')).toBe(2);
  });

  it('does NOT divide the đồng — this was the hundredfold bug', () => {
    // Stored 200000 means 200,000₫. The old code showed ₫2,000.
    expect(formatMoney(200000, 'VND', 'vi-VN')).toContain('200.000');
    expect(formatMoney(200000, 'VND', 'vi-VN')).not.toContain('2.000 ₫');
  });

  it('writes it the way the country writes it', () => {
    // Right amount, wrong shape is still wrong: en-US puts the symbol first
    // and groups with commas, which is not how đồng is written.
    expect(formatMoney(200000, 'VND', 'vi-VN')).toMatch(/200\.000/);
  });

  it('survives a currency code that makes no sense', () => {
    expect(() => formatMoney(5500, 'NOT_A_CURRENCY', 'en-US')).not.toThrow();
    expect(() => formatMoney(5500, '', 'en-US')).not.toThrow();
  });
});

describe('which language a salon writes to its own customers in', () => {
  it('follows the country it chose', () => {
    expect(localeForCountry('VN', null)).toBe('vi-VN');
    expect(localeForCountry('US', null)).toBe('en-US');
    expect(localeForCountry('CA', null)).toBe('en-US');
  });

  it('falls back to the timezone, which is how salons behaved before the setting existed', () => {
    expect(localeForCountry('', 'Asia/Ho_Chi_Minh')).toBe('vi-VN');
    expect(localeForCountry('', 'America/New_York')).toBe('en-US');
  });

  it('answers en-US when nothing is known, so an untouched salon is untouched', () => {
    expect(localeForCountry('', '')).toBe('en-US');
    expect(localeForCountry(null, null)).toBe('en-US');
  });

  it('lets an explicit country win over the timezone', () => {
    expect(localeForCountry('US', 'Asia/Ho_Chi_Minh')).toBe('en-US');
  });
});
