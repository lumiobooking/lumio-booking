import { aiPriceText, priceMode, totalText } from './price-label';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe('a service with no price is never "$0" (VN Nails, 6 Nov 2026)', () => {
  it('0 is "priced at the salon" unless the salon marked it free', () => {
    expect(priceMode({ priceCents: 0 })).toBe('salon');
    expect(priceMode({ priceCents: 0, priceFrom: true })).toBe('salon');
    expect(priceMode({ priceCents: 0, isFree: true })).toBe('free');
    expect(priceMode({ priceCents: 4500 })).toBe('fixed');
    expect(priceMode({ priceCents: 4500, priceFrom: true })).toBe('from');
    // A price entered wins over a stale free flag.
    expect(priceMode({ priceCents: 4500, isFree: true })).toBe('fixed');
  });

  it('the AI reads it out without inventing a number', () => {
    expect(aiPriceText({ priceCents: 0 }, money)).toMatch(/quoted at the salon.*never invent/);
    expect(aiPriceText({ priceCents: 0 }, money)).not.toContain('$0');
    expect(aiPriceText({ priceCents: 0, isFree: true }, money)).toBe('free');
    expect(aiPriceText({ priceCents: 4500, priceFrom: true }, money)).toMatch(/^\$45\.00 and up/);
    expect(aiPriceText({ priceCents: 4500 }, money)).toBe('$45.00');
  });

  it('a booking total of 0 says so in words, in the salon\'s language', () => {
    expect(totalText(0, money, false)).toBe('Priced at the salon');
    expect(totalText(0, money, true)).toBe('Báo giá tại tiệm');
    expect(totalText(2700, money, false)).toBe('$27.00');
  });
});
