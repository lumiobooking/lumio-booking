import * as fs from 'fs';
import * as path from 'path';
import { cleanDiscount, offCents, onSale, pctOf, salePrice, shownPercent } from './discount';
import { netCents, priceService } from '../display/checkin-pricing';

describe('giá gạch: percent or amount off', () => {
  it('a percent, as before', () => {
    expect(salePrice({ priceCents: 300000, discountPercent: 20 })).toBe(240000);
    expect(shownPercent({ priceCents: 300000, discountPercent: 20 })).toBe(20);
  });

  it('an amount off is exact (no rounding through a percent)', () => {
    expect(salePrice({ priceCents: 300000, discountCents: 50000 })).toBe(250000);
    expect(offCents({ priceCents: 300000, discountCents: 50000 })).toBe(50000);
    expect(shownPercent({ priceCents: 300000, discountCents: 50000 })).toBe(17);
  });

  it('an amount wins over a percent, never below zero, never more than the price', () => {
    expect(salePrice({ priceCents: 1000, discountPercent: 50, discountCents: 100 })).toBe(900);
    expect(salePrice({ priceCents: 1000, discountCents: 5000 })).toBe(0);
    expect(onSale({ priceCents: 1000 })).toBe(false);
    expect(pctOf(150)).toBe(90);
    expect(pctOf(-3)).toBe(0);
  });

  it('a save keeps exactly one kind', () => {
    expect(cleanDiscount({ kind: 'percent', discountPercent: 20, discountCents: 500 }, 1000)).toEqual({ discountPercent: 20, discountCents: 0 });
    expect(cleanDiscount({ kind: 'amount', discountPercent: 20, discountCents: 5000 }, 1000)).toEqual({ discountPercent: 0, discountCents: 1000 });
    expect(cleanDiscount({ kind: 'none', discountPercent: 20, discountCents: 500 }, 1000)).toEqual({ discountPercent: 0, discountCents: 0 });
    expect(cleanDiscount({ discountPercent: 10 }, 1000)).toEqual({ discountPercent: 10, discountCents: 0 });
    expect(cleanDiscount({ discountPercent: 10, discountCents: 200 }, 1000)).toEqual({ discountPercent: 0, discountCents: 200 });
  });

  it('the check-in screen and the booking agree on an amount off, then today’s promo', () => {
    expect(netCents(300000, 0, 10, 50000)).toBe(225000);
    const p = priceService({ id: 'a', name: 'Gel', priceCents: 300000, discountCents: 50000, durationMinutes: 30 }, { enabled: false } as never, {} as never);
    expect(p).toMatchObject({ netCents: 250000, discountCents: 50000, discountPercent: 17 });
  });

  it('web and api share the same rules', () => {
    const api = fs.readFileSync(path.join(__dirname, 'discount.ts'), 'utf8');
    const web = fs.readFileSync(path.join(__dirname, '../../../web/src/lib/discount.ts'), 'utf8');
    const body = (src: string) => src.slice(src.indexOf('export type Discountable'), src.indexOf('export function cleanDiscount'));
    expect(body(web)).toBe(body(api));
  });
});
