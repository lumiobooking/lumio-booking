import { adsPitch } from './ads-pitch';
import { viOf, enOf } from './i18n';

const base = { ceilingCents: 3800, dailyCents: 1400, days: 14, totalCents: 19600, bookingsToBreakEven: 6, openSlots: 14, feasible: 'yes' as const };

describe('adsPitch', () => {
  it('offers three numbers and a yes, in the shop\'s own words', () => {
    const p = adsPitch(base);
    expect(p.state).toBe('offer');
    expect(p.figures.map((f) => f.value)).toEqual(['$14', '$196', '$38']);
    expect(viOf(p.why)).toMatch(/để lại cho tiệm khoảng \$38.*mỗi khách tốn dưới \$38 thì tiệm lãi ngay/);
    expect(viOf(p.why)).toMatch(/cần 6 khách để lấy lại tiền, mà khung giờ trống của tiệm còn chỗ cho 14/);
    expect(viOf(p.cta!)).toBe('Đồng ý — chạy thử 14 ngày');
  });

  it('leaves the trade\'s vocabulary on the team\'s side of the wall', () => {
    const both = Object.values(adsPitch(base)).map((v) => JSON.stringify(v)).join(' ');
    expect(both).not.toMatch(/CPA|break-even CPA|hoà vốn CPA|feasib|lifetime|LTV|phép đo/i);
  });

  it('promises the switch-off before it is needed', () => {
    // The sentence that makes a yes safe to give has to be on the screen at
    // the moment of the yes, not produced later in an argument.
    expect(viOf(adsPitch(base).why)).toMatch(/tự tắt nếu vượt ngưỡng/);
    expect(enOf(adsPitch(base).why)).toMatch(/switch it off ourselves if it goes over the line/);
  });

  it('SAYS NO when there are not enough free chairs, and offers nothing', () => {
    // An agency that recommends advertising to every salon in every month is
    // an agency whose recommendation carries no information.
    const p = adsPitch({ ...base, feasible: 'no', bookingsToBreakEven: 20, openSlots: 4 });
    expect(p.state).toBe('not-yet');
    expect(p.cta).toBeNull();
    expect(p.request).toBeNull();
    expect(p.figures).toEqual([]);
    expect(viOf(p.why)).toMatch(/cần 20 khách.*chỉ còn chỗ cho 4.*mua khách không có ghế ngồi/);
    expect(viOf(p.why)).toMatch(/lấp chỗ trống bằng khách cũ trước/);
  });

  it('names the figure it is missing rather than guessing a budget', () => {
    const m = adsPitch({ ...base, ceilingCents: null, missing: 'margin' });
    expect(m.state).toBe('unknown');
    expect(m.cta).toBeNull();
    expect(viOf(m.why)).toMatch(/trả công thợ bao nhiêu phần trăm/);
    const t = adsPitch({ ...base, ceilingCents: null, missing: 'ticket' });
    expect(viOf(t.why)).toMatch(/chưa đủ lịch hẹn để biết hoá đơn trung bình/);
  });

  it('writes the line the team reads when the shop says yes', () => {
    expect(adsPitch(base).request).toBe('Tiệm đồng ý chạy quảng cáo thử: $14/ngày × 14 ngày (~$196) · ngưỡng $38/khách mới');
  });
});
