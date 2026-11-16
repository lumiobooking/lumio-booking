import { extensionCharge, policyFrom, shrinkExtensions, roundUnit } from './extension-price';

describe('gia hạn — what a longer visit costs', () => {
  it('prorates the main service by default: $100 / 60 min → +30 min = $50', () => {
    const p = policyFrom(null);
    expect(p.mode).toBe('prorate');
    expect(extensionCharge(p, { minutes: 30, mainPriceCents: 10000, mainMinutes: 60, currency: 'USD' })).toBe(5000);
    expect(extensionCharge(p, { minutes: 15, mainPriceCents: 10000, mainMinutes: 60, currency: 'USD' })).toBe(2500);
  });
  it('rounds to whole dollars / thousand đồng, never to zero', () => {
    expect(extensionCharge(policyFrom({}), { minutes: 20, mainPriceCents: 10000, mainMinutes: 60, currency: 'USD' })).toBe(3300);
    expect(extensionCharge(policyFrom({}), { minutes: 15, mainPriceCents: 250000, mainMinutes: 60, currency: 'VND' })).toBe(63000);
    expect(extensionCharge(policyFrom({}), { minutes: 15, mainPriceCents: 100, mainMinutes: 60, currency: 'USD' })).toBe(100);
    expect(roundUnit('VND')).toBe(1000);
  });
  it('charges a fixed price per 15 minutes, or nothing when free', () => {
    expect(extensionCharge(policyFrom({ mode: 'per15', per15Cents: 2000 }), { minutes: 45, mainPriceCents: 0, mainMinutes: 0 })).toBe(6000);
    expect(extensionCharge(policyFrom({ mode: 'free' }), { minutes: 60, mainPriceCents: 10000, mainMinutes: 60 })).toBe(0);
  });
  it('taking time back off returns the money of the newest extension, in proportion', () => {
    const lines = [{ kind: 'service', name: 'Hot stone', priceCents: 2000, durationMinutes: 15 }, { kind: 'extension', name: 'Gia hạn 30 phút', priceCents: 5000, durationMinutes: 30 }];
    const half = shrinkExtensions(lines, 15, 'vi');
    expect(half.refundCents).toBe(2500);
    expect(half.left).toBe(0);
    expect(half.lines[1]).toEqual({ kind: 'extension', name: 'Gia hạn 15 phút', priceCents: 2500, durationMinutes: 15 });
    const all = shrinkExtensions(lines, 45, 'vi');
    expect(all.refundCents).toBe(5000);
    expect(all.left).toBe(15);
    expect(all.lines).toHaveLength(1);
  });
});
