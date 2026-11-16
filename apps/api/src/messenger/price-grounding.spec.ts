import { explained, moneyIn, numbersIn, ungroundedMoney } from './price-grounding';

const DOC = `### BOOST — $179/tháng
Combo: Lumio Boost + Booking Starter (marketing $179 + booking $29)
### MAP FOUNDATION — $179/tháng
- Phí onboarding (1 lần): $99
### WEB SEO CORE — $499/tháng
- Phí thiết kế / tối ưu website (1 lần): $699
Giảm 5% khi cam kết 6 tháng, 10% khi 12 tháng.`;

describe('price check (price-grounding)', () => {
  it('reads money written many ways', () => {
    expect(moneyIn('Gói Boost $179/tháng, phí $1,200 và 500k đ, 3 triệu')).toEqual(expect.arrayContaining([179, 1200, 500000, 3000000]));
    expect(moneyIn('Có 12 bài và 4 video')).toEqual([]);
  });
  it('passes figures that are in the documents', () => {
    expect(ungroundedMoney('Dạ gói Boost là $179/tháng ạ, Map Foundation $179 + $99 onboarding.', [DOC])).toEqual([]);
  });
  it('passes honest arithmetic: combo sums, months, term discounts', () => {
    const k = numbersIn(DOC);
    expect(explained(208, k)).toBe(true);   // 179 + 29
    expect(explained(1074, k)).toBe(true);  // 179 × 6
    expect(explained(170, k)).toBe(true);   // 179 × 0.95 rounded
    expect(explained(1198, k)).toBe(true);  // 499 + 699
  });
  it('catches a made-up price or discount', () => {
    expect(ungroundedMoney('Gói Boost chỉ $199/tháng thôi ạ', [DOC])).toEqual([199]);
    expect(ungroundedMoney('Web SEO Core $459/tháng', [DOC])).toEqual([459]);
  });
  it('allows a figure the customer wrote themselves', () => {
    expect(ungroundedMoney('Dạ ngân sách $350 thì anh/chị hợp gói Growth ạ', [DOC, 'tôi có $350'])).toEqual([]);
  });
});
