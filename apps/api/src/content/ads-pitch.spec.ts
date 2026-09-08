import { adsPitch } from './ads-pitch';
import { viOf, enOf, bi } from './i18n';

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

  // ---- the plan itself: where, what, when, and then what -------------------

  const planned = {
    ...base,
    platform: { label: bi('Google (Tìm kiếm + Maps)', 'Google (Search + Maps)'), key: 'google' },
    secondPlatform: bi('Meta (Facebook + Instagram)', 'Meta (Facebook + Instagram)'),
    platformFromData: false,
    services: ['Gel manicure', 'Dip powder'],
    offerLine: bi('Giảm 15% khung trưa thứ Ba', '15% off Tuesday middays'),
    runDays: [bi('Thứ Hai', 'Monday'), bi('Thứ Ba', 'Tuesday')],
    pauseDays: [bi('Thứ Bảy', 'Saturday')],
    leadDays: 3,
    quietBlocks: [bi('Thứ Ba trưa', 'Tuesday midday')],
    returnDays: 35,
  };

  it('answers where the money goes, and why that channel first', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[0].head)).toBe('Google (Tìm kiếm + Maps) trước, Meta (Facebook + Instagram) sau');
    expect(viOf(s[0].body)).toMatch(/nail salon near me/);
  });

  it('follows the salon\'s OWN bookings over the default order when it can', () => {
    const s = adsPitch({ ...planned, platformFromData: true }).steps;
    expect(viOf(s[0].body)).toMatch(/Khách của tiệm đang đến từ Google/);
    expect(viOf(s[0].body)).not.toMatch(/nail salon near me/);
  });

  it('sells the services that earn most per chair-hour, with the week\'s offer', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[1].head)).toBe('Gel manicure và Dip powder — kèm Giảm 15% khung trưa thứ Ba');
    expect(viOf(s[1].body)).toMatch(/nhiều tiền nhất trên mỗi giờ ghế/);
  });

  it('names the days to run, the days to stop, and the hours to aim at', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[2].head)).toBe('Bật Thứ Hai và Thứ Ba · tắt Thứ Bảy · nhắm vào khung Thứ Ba trưa');
    expect(viOf(s[2].body)).toMatch(/đặt trước khoảng 3 ngày/);
    expect(viOf(s[2].body)).toMatch(/Ngày đông thì tắt/);
  });

  it('says what happens after the run, in both directions, before the yes', () => {
    // "And then what" is the question an owner asks a week in. Answering it at
    // the moment of the yes is what separates a plan from a pitch.
    const s = adsPitch(planned).steps;
    const last = s[s.length - 1];
    expect(viOf(last.title)).toBe('Hết 14 ngày thì sao');
    expect(viOf(last.body)).toMatch(/Dưới \$38 thì đáng tăng tiền/);
    expect(viOf(last.body)).toMatch(/vượt \$38 thì bên em tắt/);
    expect(viOf(last.body)).toMatch(/nhắn lại sau khoảng 35 ngày/);
  });

  it('drops the steps it has no facts for rather than inventing reasons', () => {
    const s = adsPitch(base).steps;
    expect(s).toHaveLength(1);
    expect(viOf(s[0].title)).toBe('Hết 14 ngày thì sao');
  });

  it('keeps the plan off the screen entirely when there is no offer', () => {
    expect(adsPitch({ ...planned, feasible: 'no' }).steps).toEqual([]);
    expect(adsPitch({ ...planned, ceilingCents: null }).steps).toEqual([]);
  });

  it('carries no team vocabulary into the plan either', () => {
    const s = JSON.stringify(adsPitch(planned).steps);
    expect(s).not.toMatch(/CPA|feasib|fillIndex|perHour|unproven|rank|status|verdict/i);
  });
});
