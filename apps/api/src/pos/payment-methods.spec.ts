import {
  defaultMethodsForMarket, methodsForSalon, ledgerProviderFor, bucketFor,
  labelFor, paymentMethod, isPaymentMethod, PAYMENT_METHODS,
} from './payment-methods';

describe('a US till must look and count exactly as it did before', () => {
  // The salons paying for this today check their end-of-day figures every
  // night. Adding methods for Vietnam must not move any of those numbers, and
  // must not rearrange the buttons under a cashier's thumb mid-shift.
  it('shows the same three buttons, in the same order', () => {
    expect(defaultMethodsForMarket('US')).toEqual(['CASH', 'CARD', 'TRANSFER']);
    expect(defaultMethodsForMarket('CA')).toEqual(['CASH', 'CARD', 'TRANSFER']);
  });

  it('offers no Vietnamese wallet on a US till', () => {
    for (const code of ['VIETQR', 'MOMO', 'ZALOPAY']) {
      expect(defaultMethodsForMarket('US')).not.toContain(code);
    }
  });

  // Transfer used to be stored as OTHER because there was no TRANSFER value.
  // Both must land on the same reporting line or the "other" total shifts on
  // the day this deploys, and half of history stops matching the other half.
  it('counts an old OTHER row and a new TRANSFER row on the same line', () => {
    expect(bucketFor('OTHER')).toBe('other');
    expect(bucketFor('TRANSFER')).toBe('other');
  });

  it('keeps cash and card on their own lines', () => {
    expect(bucketFor('CASH')).toBe('cash');
    expect(bucketFor('CARD')).toBe('card');
  });

  it('keeps the ledger provider strings other queries match on', () => {
    expect(ledgerProviderFor('CASH')).toBe('pos-cash');
    expect(ledgerProviderFor('CARD')).toBe('pos-card');
    expect(ledgerProviderFor('OTHER')).toBe('pos-transfer');
    expect(ledgerProviderFor('TRANSFER')).toBe('pos-transfer');
  });
});

describe('a Vietnamese till can tell its money apart', () => {
  // The whole point. Before this, VietQR, MoMo and ZaloPay were all OTHER, so
  // "how much came in by MoMo this month" had no answer.
  it('offers cash, card, transfer and the three local methods', () => {
    expect(defaultMethodsForMarket('VN')).toEqual(['CASH', 'CARD', 'TRANSFER', 'VIETQR', 'MOMO', 'ZALOPAY']);
  });

  it('gives every method a distinct stored value', () => {
    const codes = defaultMethodsForMarket('VN');
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('separates wallets from bank transfers in the ledger', () => {
    expect(ledgerProviderFor('MOMO')).toBe('pos-wallet');
    expect(ledgerProviderFor('ZALOPAY')).toBe('pos-wallet');
    expect(ledgerProviderFor('VIETQR')).toBe('pos-transfer');
    expect(ledgerProviderFor('MOMO')).not.toBe(ledgerProviderFor('VIETQR'));
  });

  it('names them in Vietnamese', () => {
    expect(labelFor('CASH', 'vi')).toBe('Tiền mặt');
    expect(labelFor('TRANSFER', 'vi')).toBe('Chuyển khoản');
    expect(labelFor('MOMO', 'vi')).toBe('Ví MoMo');
  });

  it('still names them in English for a bilingual counter', () => {
    expect(labelFor('CASH', 'en')).toBe('Cash');
    expect(labelFor('MOMO', 'en')).toBe('MoMo');
  });
});

describe('a salon that has chosen its own buttons', () => {
  // A salon that does not take MoMo should not have a MoMo button to press by
  // mistake at the end of a long day.
  it('shows exactly what it chose', () => {
    expect(methodsForSalon('VN', ['CASH', 'VIETQR'])).toEqual(['CASH', 'VIETQR']);
  });

  it('keeps the order the salon put them in', () => {
    expect(methodsForSalon('VN', ['VIETQR', 'CASH'])).toEqual(['VIETQR', 'CASH']);
  });

  it.each([undefined, null, 'CASH', 42, {}])('falls back to the market default for %s', (chosen) => {
    expect(methodsForSalon('VN', chosen)).toEqual(defaultMethodsForMarket('VN'));
  });

  it('falls back rather than leaving a cashier with no button at all', () => {
    expect(methodsForSalon('VN', [])).toEqual(defaultMethodsForMarket('VN'));
    expect(methodsForSalon('US', ['NOT_A_METHOD', ''])).toEqual(defaultMethodsForMarket('US'));
  });

  it('drops a value it does not recognise instead of rendering a dead button', () => {
    expect(methodsForSalon('VN', ['CASH', 'BITCOIN', 'MOMO'])).toEqual(['CASH', 'MOMO']);
  });

  it('accepts however the value was written, and de-duplicates', () => {
    expect(methodsForSalon('VN', ['cash', ' Cash ', 'CASH'])).toEqual(['CASH']);
  });
});

describe('values that should not be trusted', () => {
  it.each([null, undefined, '', '  ', 'BITCOIN', '123'])('resolves %s to OTHER rather than crashing', (code) => {
    expect(paymentMethod(code).code).toBe('OTHER');
    expect(bucketFor(code)).toBe('other');
  });

  it('an unknown market gets the US till, matching how markets resolve', () => {
    expect(defaultMethodsForMarket('ZZ')).toEqual(defaultMethodsForMarket('US'));
    expect(defaultMethodsForMarket(null)).toEqual(defaultMethodsForMarket('US'));
  });

  it('isPaymentMethod agrees with the registry', () => {
    expect(isPaymentMethod('MOMO')).toBe(true);
    expect(isPaymentMethod('momo')).toBe(true);
    expect(isPaymentMethod('BITCOIN')).toBe(false);
  });

  // OTHER must stay reachable for old rows but must never be offered: a bucket
  // anyone can press is a bucket that swallows the answer to every later
  // question about where the money came from.
  it('never offers OTHER as a button in any market', () => {
    for (const market of ['US', 'CA', 'VN', 'ZZ']) {
      expect(defaultMethodsForMarket(market)).not.toContain('OTHER');
    }
  });

  it('every method has both labels and a bucket', () => {
    for (const m of PAYMENT_METHODS) {
      expect(m.labelEn).toBeTruthy();
      expect(m.labelVi).toBeTruthy();
      expect(['cash', 'card', 'other']).toContain(m.bucket);
    }
  });
});
