import { convertMinor, currencyFixes, decimalsOf } from './menu-currency';

describe('menu prices follow the restaurant currency', () => {
  it('knows which currencies have no cents', () => {
    expect(decimalsOf('VND')).toBe(0);
    expect(decimalsOf('usd')).toBe(2);
    expect(decimalsOf(null)).toBe(2);
  });
  it('a phở typed as 85000 but saved as USD cents comes back to 85.000 đ', () => {
    expect(convertMinor(8_500_000, 'USD', 'VND')).toBe(85_000);
    expect(convertMinor(1450, 'USD', 'CAD')).toBe(1450);
    expect(convertMinor(85_000, 'VND', 'USD')).toBe(8_500_000);
  });
  it('fixes only the dishes whose label is wrong', () => {
    expect(currencyFixes([
      { id: 'a', priceCents: 8_500_000, currency: 'USD' },
      { id: 'b', priceCents: 85_000, currency: 'VND' },
    ], 'VND')).toEqual([{ id: 'a', priceCents: 85_000 }]);
    expect(currencyFixes([{ id: 'a', priceCents: 1200, currency: 'USD' }], 'USD')).toEqual([]);
  });
});
