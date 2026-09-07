import { holidayIdeas, ideaAsRequest, roundedDiscount } from './holiday-offers';
import { bi, viOf, enOf } from './i18n';
import type { DatedEvent } from './region-events';

const ev = (o: Partial<DatedEvent>): DatedEvent => ({
  name: 'Halloween', date: '2026-10-31', daysAway: 40, spanDays: 0, note: '', scope: 'national', precision: 'exact', ...o,
});

describe('holidayIdeas', () => {
  it('rounds the discount down to a five inside the shop\'s own ceiling, 10% when the margin is unknown', () => {
    expect(roundedDiscount(null)).toBe(10);
    expect(roundedDiscount(23)).toBe(20);
    expect(roundedDiscount(7)).toBe(5);
    expect(roundedDiscount(80)).toBe(30);
  });

  it('offers a percentage before an ordinary holiday, over the four days people book ahead', () => {
    const [i] = holidayIdeas([ev({})], { industry: 'NAIL', ceilingPct: 18 });
    expect(i.offer).toMatchObject({ kind: 'percent', value: 15, expires: '2026-10-31' });
    expect(viOf(i.window)).toBe('Từ 27/10 đến 31/10');
    expect(viOf(i.idea)).toMatch(/giảm 15%/);
    expect(enOf(i.idea)).toMatch(/15% off/);
  });

  it('offers a gift, not a discount, on the days people come to buy a gift', () => {
    const [i] = holidayIdeas([ev({ name: bi('Ngày của Mẹ', "Mother's Day"), date: '2027-05-09', daysAway: 30 })], { industry: 'NAIL', ceilingPct: 18 });
    expect(i.offer.kind).toBe('gift');
    expect(i.offer.gift).toMatch(/2 móng/);
    expect(i.key).toBe("2027-05-09-mother-s-day");
  });

  it('keeps a busy season to an early-booking morning offer, and runs it over the season', () => {
    const [i] = holidayIdeas([ev({ name: bi('Mùa prom', 'Prom season'), date: '2027-04-15', daysAway: 20, spanDays: 45 })], { industry: 'NAIL', ceilingPct: 18 });
    expect(i.offer).toMatchObject({ kind: 'percent', value: 10, slot: 'morning', expires: '2027-05-15' });
  });

  it('skips what is past or beyond the horizon, and writes a request line the team can act on', () => {
    const ideas = holidayIdeas([ev({ daysAway: -1 }), ev({ daysAway: 90 }), ev({ daysAway: 10 })], { ceilingPct: null });
    expect(ideas).toHaveLength(1);
    expect(ideaAsRequest(ideas[0])).toMatch(/^Tiệm muốn chạy ưu đãi Halloween \(2026-10-31\) — Giảm 10%/);
  });
});
