import { disclosesBeforeQualifying, hasIdentitySignal } from './sales-guards';

/**
 * The conversation that prompted this (Quynh Nguyen, Lashes Nails & Spa):
 * the customer sent a Google Maps screenshot and a business card, the bot
 * read the shop's name aloud, the customer said "Yes" — and the price reply
 * was blocked by the qualify gate, because the gate read only TYPED words.
 * The bot was forced to ask for the shop name and city again, twice.
 */
describe('the qualify gate knows what the customer showed us', () => {
  const price = 'Dạ gói Starter là $59/tháng ạ.';

  it('still blocks a price for someone who has said nothing about their shop', () => {
    expect(disclosesBeforeQualifying('[Khách gửi 1 ảnh] Do em Yes', price)).toBe(true);
  });

  it('lets the price through once a photo identified the shop', () => {
    const words = '[Khách gửi 1 ảnh]\n[Nội dung ảnh khách gửi (hệ thống đã đọc): DOANH NGHIỆP: Lashes Nails & Spa | 15001 183 A Toll Rd, Ste R400 | Cedar Park, TX | (512) 528-5053] Do em Yes';
    // The phone on the card is itself enough …
    expect(disclosesBeforeQualifying(words, price)).toBe(false);
    // … and a card with no phone is settled by the flag the service sets.
    expect(disclosesBeforeQualifying('[Khách gửi 1 ảnh] Yes', price, true)).toBe(false);
  });

  it('a lead or a memory that already names the shop counts', () => {
    expect(hasIdentitySignal('- Tên tiệm: Lashes Nails & Spa, SĐT 512 528 5053')).toBe(true);
    expect(hasIdentitySignal('- Khách hỏi giá gói')).toBe(false);
  });
});
