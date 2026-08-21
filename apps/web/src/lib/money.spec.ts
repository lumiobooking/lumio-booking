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

import { currencySymbolFor } from './money';
import { setUiCurrencySymbol, applyCurrency, uiCurrencySymbol, onUiCurrencyChange } from './ui-currency';

describe('a Vietnamese till must not ask for dollars', () => {
  // From a screenshot of a live Vietnamese salon: the cash field read "Tien
  // khach dua $". Thirteen labels had a dollar sign typed straight into them,
  // in BOTH translations, so the Vietnamese text was wrong too. Not cosmetic:
  // on a money field the symbol is what tells the owner what scale to type in,
  // and the wrong scale is the bug that turned 200,000d into d2,000 elsewhere.
  it('knows the symbol for each currency', () => {
    expect(currencySymbolFor('VND')).toBe('\u20ab');
    expect(currencySymbolFor('USD')).toBe('$');
  });

  it('falls back to the code rather than to a wrong symbol', () => {
    expect(currencySymbolFor('NOT_A_CURRENCY')).toBe('NOT_A_CURRENCY');
  });

  it('writes the salon own symbol into a label', () => {
    setUiCurrencySymbol('\u20ab');
    expect(applyCurrency('Ti\u1ec1n kh\u00e1ch \u0111\u01b0a {c}')).toBe('Ti\u1ec1n kh\u00e1ch \u0111\u01b0a \u20ab');
    expect(applyCurrency('\u0110\u01a1n gi\u00e1 ({c})')).toBe('\u0110\u01a1n gi\u00e1 (\u20ab)');
  });

  it('leaves a US till reading exactly as it did before', () => {
    setUiCurrencySymbol('$');
    expect(applyCurrency('Cash received {c}')).toBe('Cash received $');
    expect(applyCurrency('Amount ({c})')).toBe('Amount ($)');
  });

  it('defaults to the dollar every one of those labels used to hardcode', () => {
    // So an app that never calls the setter behaves exactly as before.
    expect(typeof uiCurrencySymbol()).toBe('string');
  });

  it('ignores an empty symbol rather than blanking every money field at once', () => {
    setUiCurrencySymbol('$');
    setUiCurrencySymbol('');
    setUiCurrencySymbol('   ');
    expect(applyCurrency('Cash received {c}')).toBe('Cash received $');
  });

  it('leaves labels with no money in them untouched', () => {
    setUiCurrencySymbol('\u20ab');
    expect(applyCurrency('B\u00e1n h\u00e0ng / Thu ng\u00e2n')).toBe('B\u00e1n h\u00e0ng / Thu ng\u00e2n');
  });

  it('replaces every occurrence, not just the first', () => {
    setUiCurrencySymbol('\u20ab');
    expect(applyCurrency('{c} to {c}')).toBe('\u20ab to \u20ab');
  });
});

describe('the symbol change has to reach the screen', () => {
  // The first version of this worked by coincidence: React does not re-render
  // because a module variable changed, and the labels only corrected
  // themselves because the setter happened to sit next to some setState calls.
  it('tells anyone who is listening', () => {
    // Baseline set BEFORE subscribing: this suite shares module state with the
    // ones above, and a test that only passes in a particular order is a test
    // that will fail for a reason unrelated to the change that breaks it.
    setUiCurrencySymbol('$');
    let calls = 0;
    const off = onUiCurrencyChange(() => { calls += 1; });
    setUiCurrencySymbol('₫');
    expect(calls).toBe(1);
    off();
    setUiCurrencySymbol('$');
    expect(calls).toBe(1);
  });

  it('stays quiet when the symbol has not actually changed', () => {
    setUiCurrencySymbol('₫');
    let calls = 0;
    const off = onUiCurrencyChange(() => { calls += 1; });
    setUiCurrencySymbol('₫');
    setUiCurrencySymbol('');
    expect(calls).toBe(0);
    off();
  });

  it('one broken listener does not stop the others', () => {
    setUiCurrencySymbol('$');
    let reached = false;
    const offA = onUiCurrencyChange(() => { throw new Error('boom'); });
    const offB = onUiCurrencyChange(() => { reached = true; });
    expect(() => setUiCurrencySymbol('₫')).not.toThrow();
    expect(reached).toBe(true);
    offA(); offB();
  });
});
