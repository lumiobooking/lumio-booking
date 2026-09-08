import { competitionPicture, type NearbyPlace } from './competition';
import { viOf, enOf } from './i18n';

const p = (name: string, reviews: number, rating = 4.6, isMine = false): NearbyPlace =>
  ({ name, reviews, rating, ...(isMine ? { isMine: true } : {}) });

describe('competitionPicture', () => {
  it('turns "the area is competitive" into a gap with a deadline on it', () => {
    const c = competitionPicture([
      p('Lux Nail Spa', 34, 4.8, true),
      p('A', 310), p('B', 240), p('C', 180), p('D', 90), p('E', 40),
    ])!;
    expect(c.rivals).toBe(5);
    expect(c.myReviews).toBe(34);
    expect(c.top.map((t) => t.reviews)).toEqual([310, 240, 180]);
    expect(c.gapToTop3).toBe(146);          // to the THIRD, not the first — a reachable target
    expect(c.weeksAtTwoADay).toBe(11);
    expect(viOf(c.soWhat)).toMatch(/Cần thêm 146 đánh giá.*khoảng 11 tuần/);
  });

  it('reads crowding as a statement about the landing, never about the click price', () => {
    const c = competitionPicture([p('mine', 500, 4.9, true), ...Array.from({ length: 14 }, (_, i) => p(`r${i}`, 50))])!;
    expect(c.density).toBe('crowded');
    expect(c.gapToTop3).toBe(0);
    // No forecast of what a click will cost — that depends on who is bidding
    // this week, which no count of shops can tell you.
    expect(`${viOf(c.soWhat)} ${enOf(c.soWhat)}`).not.toMatch(/\$|CPC|click cost|giá click/i);
    expect(viOf(c.soWhat)).toMatch(/đủ dày để chịu được lượt click trả tiền/);
  });

  it('says the profile is missing rather than inventing a rank for it', () => {
    const c = competitionPicture([p('A', 300), p('B', 100)])!;
    expect(c.myReviews).toBeNull();
    expect(c.gapToTop3).toBeNull();
    expect(viOf(c.soWhat)).toMatch(/dựng và xác minh hồ sơ, trước khi bỏ tiền/);
  });

  it('counts density off the rivals, not off the list it was handed', () => {
    expect(competitionPicture([p('mine', 10, 4, true), p('a', 1), p('b', 2), p('c', 3), p('d', 4)])!.density).toBe('quiet');
    expect(competitionPicture([p('mine', 10, 4, true), ...Array.from({ length: 5 }, (_, i) => p(`r${i}`, 9))])!.density).toBe('busy');
  });

  it('returns nothing rather than an empty verdict when the scan found nobody', () => {
    expect(competitionPicture([])).toBeNull();
  });
});
