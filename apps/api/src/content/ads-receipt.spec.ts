import { adsReceipt } from './ads-receipt';
import { viOf, enOf } from './i18n';

describe('adsReceipt', () => {
  it('shows nothing at all in a month with no spend', () => {
    // An empty receipt reads as a bad result. A month with no ads is not one.
    expect(adsReceipt({ spendCents: 0, fromAds: 4, newTotal: 20, ceilingCents: 3800 })).toBeNull();
  });

  it('divides by the customers the ADS brought, never by every new face', () => {
    const r = adsReceipt({ spendCents: 30000, fromAds: 11, newTotal: 24, ceilingCents: 3800 })!;
    expect(r.perCustomerCents).toBe(Math.round(30000 / 11));
    expect(r.verdict).toBe('good');
    expect(viOf(r.headline)).toBe('$300 cho 11 khách mới — $27 mỗi khách, dưới ngưỡng $38. Mỗi khách mới còn lãi khoảng $11 ngay lần đầu.');
    // The whole-shop number travels beside it, as context and never as the divisor.
    expect(viOf(r.caveat)).toMatch(/Cả tiệm có 24 khách mới tháng này/);
  });

  it('refuses to compute a cost per customer off two or three bookings', () => {
    const r = adsReceipt({ spendCents: 30000, fromAds: 2, newTotal: 9, ceilingCents: 3800 })!;
    expect(r.verdict).toBe('early');
    expect(r.perCustomerCents).toBeNull();
    expect(viOf(r.headline)).toMatch(/chưa đủ để nói mỗi khách tốn bao nhiêu/);
  });

  it('says over the line plainly, and says what happens next', () => {
    // The sentence a client remembers is the one where the agency says it will
    // switch its own revenue off. It has to be there before it is needed.
    const r = adsReceipt({ spendCents: 60000, fromAds: 10, newTotal: 18, ceilingCents: 3800 })!;
    expect(r.verdict).toBe('over');
    expect(viOf(r.headline)).toMatch(/trên ngưỡng \$38.*sẽ tắt chứ không để chạy tiếp/);
    expect(enOf(r.headline)).toMatch(/we switch it off rather than let it run/);
  });

  it('has a middle verdict, so a campaign 5% over is not reported as a failure', () => {
    expect(adsReceipt({ spendCents: 40000, fromAds: 10, newTotal: 18, ceilingCents: 3800 })!.verdict).toBe('tight');
    expect(adsReceipt({ spendCents: 43700, fromAds: 10, newTotal: 18, ceilingCents: 3800 })!.verdict).toBe('tight');
    expect(adsReceipt({ spendCents: 44000, fromAds: 10, newTotal: 18, ceilingCents: 3800 })!.verdict).toBe('over');
  });

  it('reports the cost without a verdict when the salon has no margin on file', () => {
    const r = adsReceipt({ spendCents: 30000, fromAds: 10, newTotal: 20, ceilingCents: null })!;
    expect(r.verdict).toBe('no-ceiling');
    expect(r.perCustomerCents).toBe(3000);
    expect(viOf(r.headline)).toMatch(/Chưa có tỷ lệ ăn chia thợ/);
  });
});
