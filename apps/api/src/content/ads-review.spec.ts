import {
  reviewDays, reviewDate, dueReviews, nextReview, reviewVerdict, reviewReport,
  reviewJobText, READABLE_BOOKINGS, type Campaign,
} from './ads-review';
import { adsPitch } from './ads-pitch';
import { viOf, enOf } from './i18n';

const live: Campaign = { startedAt: '2026-09-01', days: 14, dailyCents: 1500, ceilingCents: 2600 };

describe('the review days match the days the card promised', () => {
  it('lands on day 7 and day 14 for a fortnight', () => {
    expect(reviewDays(14)).toEqual([7, 14]);
  });

  it('never schedules a mid-review before day 3, however short the run', () => {
    expect(reviewDays(4)).toEqual([3, 4]);
    expect(reviewDays(3)).toEqual([3]);
    expect(reviewDays(2)).toEqual([2]);
  });

  it('counts day 1 as the start day, not the day after', () => {
    expect(reviewDate('2026-09-01', 1)).toBe('2026-09-01');
    expect(reviewDate('2026-09-01', 7)).toBe('2026-09-07');
    expect(reviewDate('2026-09-01', 14)).toBe('2026-09-14');
  });
});

describe('the team is told before the day, not after', () => {
  it('shows a review that is still ahead, with how far', () => {
    const r = dueReviews(live, '2026-09-04');
    expect(r[0]).toMatchObject({ dayNumber: 7, dueDate: '2026-09-07', lateDays: -3, done: false });
  });

  it('counts the days it is overdue, because that is the number that shames', () => {
    const r = dueReviews(live, '2026-09-10');
    expect(r[0].lateDays).toBe(3);
    expect(r[1].lateDays).toBe(-4);
  });

  it('drops a review once somebody has actually sent it', () => {
    const done: Campaign = { ...live, done: { '7': { at: '2026-09-07', by: 'Vy' } } };
    expect(dueReviews(done, '2026-09-10')[0].done).toBe(true);
    expect(nextReview(done, '2026-09-10')!.dayNumber).toBe(14);
  });

  it('says nothing at all until the campaign is actually live', () => {
    expect(dueReviews({ ...live, startedAt: null }, '2026-09-10')).toEqual([]);
    expect(nextReview({ ...live, startedAt: null }, '2026-09-10')).toBeNull();
  });
});

describe('the verdict refuses to read numbers too small to mean anything', () => {
  it('calls it too early below the same bar the card names', () => {
    expect(READABLE_BOOKINGS).toBe(8);
    expect(reviewVerdict({ spentCents: 10500, fromAds: 4, ceilingCents: 2600 })).toBe('too-early');
    // Four customers at $26 each would look fine. It is still noise.
    expect(reviewVerdict({ spentCents: 400, fromAds: 4, ceilingCents: 2600 })).toBe('too-early');
  });

  it('separates comfortably-under from only-just, because they need opposite moves', () => {
    expect(reviewVerdict({ spentCents: 16000, fromAds: 10, ceilingCents: 2600 })).toBe('winning');
    expect(reviewVerdict({ spentCents: 25000, fromAds: 10, ceilingCents: 2600 })).toBe('tight');
    expect(reviewVerdict({ spentCents: 30000, fromAds: 10, ceilingCents: 2600 })).toBe('losing');
  });

  it('refuses to judge at all when there is no margin on file', () => {
    expect(reviewVerdict({ spentCents: 30000, fromAds: 10, ceilingCents: null })).toBe('no-ceiling');
  });
});

describe('the message is written, not left to somebody on a Tuesday', () => {
  const base = { dayNumber: 7, days: 14, ceilingCents: 2600 };

  it('carries the three numbers and the shop can check every one', () => {
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 10 });
    expect(r.figures.map((f) => f.value)).toEqual(['$105', '10', '$11']);
    expect(viOf(r.message)).toMatch(/Đã chi \$105 · 10 khách mới từ quảng cáo · \$11 mỗi khách \(ngưỡng \$26\)/);
    expect(enOf(r.message)).toMatch(/\$105 spent · 10 new customers from the ads · \$11 each/);
  });

  it('LEAVES ONE BLANK, and it is the one that proves we did something', () => {
    // "We watched it" is not the service. The sentence cannot be generated.
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 10 });
    expect(viOf(r.message)).toMatch(/Tuần này bên em đã đổi: ___$/);
    expect(enOf(r.message)).toMatch(/What we changed this week: ___$/);
  });

  it('says plainly when there is not enough to read, instead of inventing a verdict', () => {
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 3 });
    expect(r.verdict).toBe('too-early');
    expect(viOf(r.message)).toMatch(/chưa đọc được gì chắc chắn/);
    expect(viOf(r.doNext)).toMatch(/Chưa đổi gì/);
  });

  it('tells the person to FIX IT FIRST when the campaign is losing money', () => {
    const r = reviewReport({ ...base, spentCents: 30000, fromAds: 10 });
    expect(r.verdict).toBe('losing');
    expect(viOf(r.doNext)).toMatch(/Sửa NGAY hôm nay/);
    expect(viOf(r.doNext)).toMatch(/Rồi mới gửi tin/);
    expect(viOf(r.message)).toMatch(/Bên em sửa ngay trong hôm nay/);
  });

  it('does not tell a winning campaign to spend more when it is only just ahead', () => {
    expect(viOf(reviewReport({ ...base, spentCents: 25000, fromAds: 10 }).doNext)).toMatch(/Không tăng ngân sách/);
    expect(viOf(reviewReport({ ...base, spentCents: 16000, fromAds: 10 }).doNext)).toMatch(/Dồn thêm tiền/);
  });

  it('asks for the missing margin rather than reporting a number it cannot judge', () => {
    const r = reviewReport({ ...base, ceilingCents: null, spentCents: 30000, fromAds: 10 });
    expect(viOf(r.message)).toMatch(/chưa nhập tỷ lệ ăn chia thợ/);
    expect(viOf(r.message)).not.toMatch(/ngưỡng \$/);
  });

  it('handles a review with no customers at all without dividing by zero', () => {
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 0 });
    expect(r.perCustomerCents).toBeNull();
    expect(r.figures[2].value).toBe('—');
    expect(viOf(r.message)).toMatch(/chưa tính được mỗi khách/);
  });

  it('says when the spend is the approved budget rather than a measured figure', () => {
    // MarketingSpend is monthly, so a fortnight cannot be sliced out of it.
    // Presenting a projection as a measurement is how the rest of the report
    // stops being believed.
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 10, spendEstimated: true });
    expect(viOf(r.message)).toMatch(/theo ngân sách đã duyệt — chưa nhập số thật từ nền tảng/);
    expect(enOf(r.message)).toMatch(/the approved budget — the platform figure has not been entered yet/);
    // and stays silent when the number IS real
    expect(viOf(reviewReport({ ...base, spentCents: 10500, fromAds: 10 }).message)).not.toMatch(/ngân sách đã duyệt/);
  });

  it('names the advertised service so the owner recognises her own campaign', () => {
    const r = reviewReport({ ...base, spentCents: 10500, fromAds: 10, service: { vi: 'Dip Powder', en: 'Dip Powder' } });
    expect(viOf(r.message)).toMatch(/Quảng cáo đang bán: Dip Powder/);
  });

  it('writes the queue line with the salon in it, so a list of twelve reads', () => {
    expect(viOf(reviewJobText(7, 'Lux Nail Spa'))).toBe('Soi quảng cáo Lux Nail Spa — ngày thứ 7, rồi báo tiệm ba con số');
  });
});

/**
 * THE CARD AND THE QUEUE MUST NAME THE SAME DAY.
 *
 * The owner reads "ngày thứ 7 và ngày thứ 14" above the button she presses.
 * If the schedule behind it ever says day 8, the promise was decoration — and
 * she finds that out in week two, which is worse than never promising.
 */
describe('the promise on the card and the schedule behind it cannot drift', () => {
  const pitchDays = (days: number) => {
    const step = adsPitch({
      ceilingCents: 2600, dailyCents: 1500, days, totalCents: 1500 * days,
      bookingsToBreakEven: 8, openSlots: 40, feasible: 'yes',
    }).steps.find((x) => viOf(x.title) === 'Mỗi tuần bên em làm gì')!;
    return (viOf(step.head).match(/\d+/g) ?? []).map(Number);
  };

  it('prints exactly the days the review schedule will fire on', () => {
    for (const days of [7, 14, 21, 28]) {
      expect(pitchDays(days)).toEqual(reviewDays(days));
    }
  });

  it('and the "enough to read" bar is the same number in both places', () => {
    // The channel step's condition names it to the owner; the review uses it
    // to decide whether any figure can be read at all.
    const step = adsPitch({
      ceilingCents: 2600, dailyCents: 1500, days: 14, totalCents: 21000,
      bookingsToBreakEven: READABLE_BOOKINGS, openSlots: 40, feasible: 'yes',
      platform: { label: { vi: 'Google', en: 'Google' }, key: 'google' },
      secondPlatform: { vi: 'Meta', en: 'Meta' },
      platformShort: { vi: 'Google', en: 'Google' }, secondShort: { vi: 'Meta', en: 'Meta' },
      provingBookings: READABLE_BOOKINGS,
    }).steps.find((x) => viOf(x.title) === 'Chạy ở kênh nào')!;
    expect(viOf(step.when!)).toContain(`${READABLE_BOOKINGS} booking`);
  });
});
