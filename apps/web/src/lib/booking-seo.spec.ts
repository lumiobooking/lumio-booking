import { seoText, tradeOf } from './booking-seo';

describe('the booking link preview names the right trade', () => {
  it('hair, massage and restaurants are never "nail"', () => {
    expect(seoText({ name: 'Mai Hair', trade: 'HAIR' }).title).toBe('Mai Hair — Book a Hair Appointment Online');
    expect(seoText({ name: 'An Sen', trade: 'MASSAGE' }).lead).toBe('Book your massage at An Sen online');
    expect(seoText({ name: "Kin's", trade: 'RESTAURANT', businessType: 'RESTAURANT' }).title).toBe("Kin's — Book a Table Online");
    for (const t of ['HAIR', 'MASSAGE', 'SPA', 'LASH', 'BEAUTY', 'RESTAURANT', 'CAFE', 'SERVICE', 'DENTAL', 'REAL_ESTATE']) {
      const x = seoText({ name: 'X', trade: t });
      expect(`${x.title} ${x.lead} ${x.how}`).not.toMatch(/nail/i);
    }
  });
  it('nail only when the trade is nail', () => {
    expect(seoText({ name: 'Lux', trade: 'NAIL' }).title).toBe('Lux — Book a Nail Appointment Online');
    expect(seoText({ name: 'Lux', trade: 'NAIL' }).schema).toBe('NailSalon');
  });
  it('an older API with no trade falls back to the business type, never nail', () => {
    expect(tradeOf({ businessType: 'SALON' })).toBe('BEAUTY');
    expect(tradeOf({ businessType: 'SERVICE' })).toBe('SERVICE');
    expect(tradeOf({ businessType: 'RESTAURANT', trade: 'bogus' })).toBe('RESTAURANT');
  });
  it('shops in Vietnam get Vietnamese wording', () => {
    expect(seoText({ name: 'Tóc Xinh', trade: 'HAIR', currency: 'VND' }).title).toBe('Tóc Xinh — Đặt lịch làm tóc online');
    expect(seoText({ name: 'Phở Hằng', trade: 'RESTAURANT', currency: 'VND' }).lead).toBe('Đặt bàn tại Phở Hằng online');
  });
});
