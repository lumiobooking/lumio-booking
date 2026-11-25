import { cleanRate, orderTax } from './order-tax';

describe('rt238 — VAT on services, per salon', () => {
  const lines = [
    { kind: 'SERVICE', lineTotalCents: 5500 }, // pedicure $55
    { kind: 'SERVICE', lineTotalCents: 3000 },
    { kind: 'PRODUCT', lineTotalCents: 1200 }, // polish $12
  ];
  it('default: services are not taxed, retail at the retail rate (unchanged behaviour)', () => {
    expect(orderTax(lines, 8.25, 0)).toEqual({ taxCents: 99, productTaxCents: 99, serviceTaxCents: 0 });
  });
  it('a salon that charges VAT on services gets it on services only at that rate', () => {
    expect(orderTax(lines, 0, 8)).toEqual({ taxCents: 680, productTaxCents: 0, serviceTaxCents: 680 });
    expect(orderTax(lines, 8.25, 10).taxCents).toBe(99 + 850);
  });
  it('rates are cleaned: no negatives, no junk, at most 30 %', () => {
    expect(cleanRate(-5)).toBe(0);
    expect(cleanRate('abc')).toBe(0);
    expect(cleanRate(55)).toBe(30);
    expect(cleanRate(8.255)).toBe(8.255);
    expect(orderTax(lines, NaN as never, -1).taxCents).toBe(0);
  });
  it('a free line adds nothing; a VND bill rounds to whole đồng', () => {
    expect(orderTax([{ kind: 'SERVICE', lineTotalCents: 0 }], 0, 10).taxCents).toBe(0);
    expect(orderTax([{ kind: 'SERVICE', lineTotalCents: 333333 }], 0, 8).taxCents).toBe(26667);
  });
});
