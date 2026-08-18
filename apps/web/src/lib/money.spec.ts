/**
 * The price boxes, locked.
 *
 * The display half of the đồng was fixed weeks before the INPUT half, and the
 * input half was the one that mattered more: every price box ran
 * `Math.round(value * 100)`, so a Vietnamese salon typing 200,000₫ stored
 * 20,000,000 and could not enter a correct price at all. The services screen
 * then hid it by dividing by 100 on the way out, so the number looked right
 * there and wrong everywhere else — the shape of bug that survives testing.
 *
 * The first block below is not about Vietnam. It is the guarantee that a US or
 * Canadian salon types, saves, reopens and reads exactly what it always did.
 */
import { toMinorUnits, fromMinorUnits, formatPrice, isZeroDecimalCurrency, priceInputStep } from './money';

/** What every price box did before toMinorUnits existed. */
const legacySave = (typed: string) => Math.round(parseFloat(typed) * 100);

describe('US and Canadian price boxes — unchanged', () => {
  const typed = ['0', '55', '54.50', '0.99', '120', '9.99', '1234.56'];

  it.each(['USD', 'CAD'])('%s saves the same integer as the old code', (currency) => {
    for (const value of typed) {
      expect(toMinorUnits(value, currency)).toBe(legacySave(value));
    }
  });

  it('reopens for editing as the same amount', () => {
    expect(fromMinorUnits(toMinorUnits('55', 'USD'), 'USD')).toBe('55.00');
    expect(fromMinorUnits(toMinorUnits('54.50', 'USD'), 'USD')).toBe('54.50');
  });

  it('adopts a price written by the old code without changing it', () => {
    // A service saved before this change reads back, and saving it again must
    // store the identical integer — otherwise every edit would shift the price.
    const stored = 5500;
    const reopened = fromMinorUnits(stored, 'USD');
    expect(toMinorUnits(reopened, 'USD')).toBe(stored);
  });

  it('still steps by a cent', () => {
    expect(priceInputStep('USD')).toBe('0.01');
    expect(priceInputStep('CAD')).toBe('0.01');
  });
});

describe('currencies with no subunit', () => {
  it('stores what was typed, not a hundred times it', () => {
    expect(legacySave('200000')).toBe(20000000); // the bug, for the record
    expect(toMinorUnits('200000', 'VND')).toBe(200000);
    expect(toMinorUnits('50000', 'VND')).toBe(50000);
    expect(toMinorUnits('1500000', 'VND')).toBe(1500000);
  });

  it('reopens without a ".00" nobody would want to delete', () => {
    expect(fromMinorUnits(200000, 'VND')).toBe('200000');
  });

  it('survives the round trip a salon actually makes', () => {
    for (const value of ['50000', '200000', '1500000']) {
      expect(fromMinorUnits(toMinorUnits(value, 'VND'), 'VND')).toBe(value);
    }
  });

  it('steps by something a person would actually change a price by', () => {
    expect(priceInputStep('VND')).toBe('1000');
    expect(priceInputStep('JPY')).toBe('1000');
  });

  it('is recognised without us maintaining a list', () => {
    expect(isZeroDecimalCurrency('VND')).toBe(true);
    expect(isZeroDecimalCurrency('JPY')).toBe(true);
    expect(isZeroDecimalCurrency('USD')).toBe(false);
  });
});

describe('rubbish input never becomes a price', () => {
  it.each(['', '   ', 'abc', 'NaN'])('%s saves as zero rather than NaN', (value) => {
    expect(toMinorUnits(value, 'USD')).toBe(0);
    expect(toMinorUnits(value, 'VND')).toBe(0);
  });

  it('does not throw on a nonsense currency', () => {
    expect(() => formatPrice(5500, 'NOT_A_CURRENCY')).not.toThrow();
    expect(() => toMinorUnits('55', '')).not.toThrow();
  });
});

describe('displaying a stored amount', () => {
  it('divides for the dollar and not for the đồng', () => {
    expect(formatPrice(5500, 'USD')).toBe('$55.00');
    expect(formatPrice(200000, 'VND')).toContain('200,000');
  });
});
