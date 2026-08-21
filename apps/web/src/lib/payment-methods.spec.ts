import { payLabel, tillMethodsFrom, isPayMethod, PAY_METHODS } from './payment-methods';

describe('a cashier always has a button to press', () => {
  // A customer is standing at the counter. If the settings call failed or
  // returned something odd, an empty row of buttons is the worst possible
  // outcome — worse than showing the wrong three.
  it.each([undefined, null, 'CASH', 42, {}, []])('falls back to the original three for %s', (resolved) => {
    expect(tillMethodsFrom(resolved)).toEqual(['CASH', 'CARD', 'TRANSFER']);
  });

  it('drops values it does not know rather than rendering a dead button', () => {
    expect(tillMethodsFrom(['CASH', 'BITCOIN', 'MOMO'])).toEqual(['CASH', 'MOMO']);
  });

  it('falls back rather than returning an empty row', () => {
    expect(tillMethodsFrom(['BITCOIN', 'DOGE'])).toEqual(['CASH', 'CARD', 'TRANSFER']);
  });

  it('shows exactly what the server resolved, in that order', () => {
    expect(tillMethodsFrom(['CASH', 'VIETQR', 'MOMO'])).toEqual(['CASH', 'VIETQR', 'MOMO']);
  });
});

describe('labels', () => {
  it('writes Vietnamese on a Vietnamese till', () => {
    expect(payLabel('CASH', 'vi')).toBe('Tiền mặt');
    expect(payLabel('TRANSFER', 'vi')).toBe('Chuyển khoản');
  });

  it('writes English on a US till', () => {
    expect(payLabel('CASH', 'en')).toBe('Cash');
    expect(payLabel('TRANSFER', 'en')).toBe('Transfer');
  });

  it('leaves brand names alone in both languages', () => {
    for (const lang of ['en', 'vi'] as const) {
      expect(payLabel('MOMO', lang)).toBe('MoMo');
      expect(payLabel('VIETQR', lang)).toBe('VietQR');
      expect(payLabel('ZALOPAY', lang)).toBe('ZaloPay');
    }
  });

  // An older tab left open through a deploy should degrade to the raw code,
  // not to a blank button whose meaning nobody can guess.
  it('shows the raw code for a method this build has not heard of', () => {
    expect(payLabel('SOMETHING_NEW', 'vi')).toBe('SOMETHING_NEW');
  });

  it('every known method has both languages', () => {
    for (const [code, def] of Object.entries(PAY_METHODS)) {
      expect(def.en).toBeTruthy();
      expect(def.vi).toBeTruthy();
      expect(isPayMethod(code)).toBe(true);
    }
  });
});
