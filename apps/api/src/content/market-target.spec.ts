import { buildMarketPlan, type MarketInput } from './market-target';
import type { AreaAudience } from './census-audience';

const money = (c: number) => `$${Math.round(c / 100)}`;

const AREA: AreaAudience = {
  ok: true, year: 2023,
  female: { '18-24': 900, '25-34': 2400, '35-44': 2100, '45-54': 1700, '55-64': 1400, '65+': 1200 },
  male: { '18-24': 950, '25-34': 2500, '35-44': 2000, '45-54': 1600, '55-64': 1300, '65+': 1000 },
  totalPopulation: 27_136,
  households: 11_000,
  incomeAtLeast: [
    { usd: 75_000, households: 6_600, pct: 60 },
    { usd: 100_000, households: 4_400, pct: 40 },
    { usd: 150_000, households: 2_200, pct: 20 },
  ],
  languages: [
    { name: 'Spanish', people: 4_200, pct: 18 },
    { name: 'Vietnamese', people: 1_800, pct: 7.7 },
  ],
  notes: [],
};

const BASE: MarketInput = {
  area: AREA,
  industry: 'SALON',
  firstVisitTicketCents: 5_000,
  grossMarginPct: 45,
  cpaCeilingCents: 2_250,
  openSlots: 20,
  campaignDays: 14,
  city: 'Austin', region: 'TX',
  money,
};

const plan = (over: Partial<MarketInput> = {}) => buildMarketPlan({ ...BASE, ...over });

describe('the target is sized from the market, not from the booking book', () => {
  const p = plan();

  it('counts the adults who actually live there', () => {
    // 18+ only: children are not a market for a salon.
    expect(p.adults).toBe(9700 + 9350);
  });

  it('names a primary segment with a real head count behind it', () => {
    expect(p.primary!.key).toBe('women-core');
    expect(p.primary!.size).toBe(2400 + 2100 + 1700);
    expect(p.primary!.basis).toMatch(/B01001/);
  });

  it('reasons outward-in: market, then target, then capacity, then money', () => {
    const joined = p.reasoning.join(' ');
    expect(p.reasoning[0]).toMatch(/người trưởng thành/);
    expect(joined).toMatch(/Tệp mục tiêu/);
    expect(joined).toMatch(/chỗ trống/);
    expect(joined).toMatch(/Trần chi/);
  });

  it('gives targeting anyone can type into the ad platform', () => {
    const t = p.primary!.targeting.join(' ');
    expect(t).toMatch(/Nữ, 25–54/);
    expect(t).toMatch(/bán kính 5 dặm/);
    // Google gets no gender filter, and the reason is stated.
    expect(t).toMatch(/không đặt giới tính/);
  });
});

describe('what the business says about itself outranks its industry code', () => {
  it('targets the language community when the shop serves one', () => {
    // The failure this fixes: a marketing agency for Vietnamese business owners
    // was handed nail-salon advice, because a four-value enum cannot tell the
    // two apart and nothing else was being read.
    const p = plan({
      industry: 'SERVICE',
      declaredWhoWeServe: 'Chủ tiệm nail người Việt tại Mỹ',
    });
    expect(p.primary!.key).toBe('language');
    expect(p.primary!.size).toBe(1_800);
    expect(p.primary!.label).toMatch(/tiếng Việt/);
    expect(p.primary!.targeting.join(' ')).toMatch(/Ngôn ngữ = Vietnamese/);
  });

  it('puts the language segment first even when a bigger one exists', () => {
    // Spanish is the larger community here; the shop does not serve it.
    const p = plan({ declaredWhoWeServe: 'người Việt' });
    expect(p.primary!.key).toBe('language');
    expect(p.segments.some((s) => s.key === 'women-core')).toBe(true);
  });

  it('ignores a language the Census did not report in this area', () => {
    const p = plan({ declaredWhoWeServe: 'cộng đồng người Hàn' });
    expect(p.primary!.key).not.toBe('language');
  });

  it('falls back to a broad adult segment when nothing narrows it', () => {
    const p = plan({ industry: 'SERVICE' });
    expect(p.primary!.key).toBe('adults-core');
    expect(p.primary!.why).toMatch(/Chưa có căn cứ để thu hẹp/);
  });
});

describe('penetration replaces the market-share figure it refuses to invent', () => {
  it('says what share of the target the empty chairs represent', () => {
    const p = plan();
    // 20 seats ÷ 6,200 women 25-54 = 0.32%
    expect(p.penetrationPct).toBe(0.32);
    expect(p.penetrationVerdict).toBe('easy');
    expect(p.reasoning.join(' ')).toMatch(/nút thắt là ở chỗ tiếp cận/);
  });

  it('calls it impossible when the chairs outnumber what the segment can feed', () => {
    const p = plan({ openSlots: 900 });
    expect(p.penetrationVerdict).toBe('impossible');
    expect(p.reasoning.join(' ')).toMatch(/mở rộng bán kính/);
  });

  it('never claims a market share', () => {
    const text = JSON.stringify(plan());
    expect(text).not.toMatch(/thị phần \d|chiếm được \d+% thị trường/);
    expect(plan().limits.join(' ')).toMatch(/KHÔNG có dữ liệu đối thủ/);
  });
});

describe('the budget ceiling comes from capacity × margin, and says it is a ceiling', () => {
  it('multiplies the seats it can fill by what a new customer is worth', () => {
    expect(plan().maxSpendCents).toBe(20 * 2_250);
    expect(plan().reasoning.join(' ')).toMatch(/Đây là TRẦN, không phải mức đề xuất/);
  });

  it('explains why spending past it cannot pay back', () => {
    expect(plan().reasoning.join(' ')).toMatch(/không còn ghế để ngồi/);
  });

  it('refuses a ceiling without a margin, and says which side the gap is on', () => {
    const p = plan({ cpaCeilingCents: null });
    expect(p.maxSpendCents).toBeNull();
    expect(p.reasoning.join(' ')).toMatch(/Thị trường nói được nhắm vào ai/);
  });

  it('never forecasts bookings from a budget', () => {
    expect(JSON.stringify(plan())).not.toMatch(/sẽ mang về|dự kiến \d+ khách|ước tính \d+ booking/);
  });
});

describe('price is read against the area, not against a feeling', () => {
  it('calls a low ticket in a rich area an upsell opportunity, not a discount one', () => {
    const p = plan({ firstVisitTicketCents: 4_000 });
    expect(p.reasoning.join(' ')).toMatch(/dư địa nằm ở bán thêm dịch vụ cao cấp chứ không phải ở giảm giá/);
  });

  it('picks the income line from the shop’s own ticket', () => {
    // A $200 first visit is judged against $150k households, not $75k ones.
    expect(plan({ firstVisitTicketCents: 20_000 }).affordable!.usd).toBe(150_000);
    expect(plan({ firstVisitTicketCents: 3_000 }).affordable!.usd).toBe(75_000);
  });

  it('says so plainly when it has no ticket to compare', () => {
    expect(plan({ firstVisitTicketCents: null }).reasoning.join(' ')).toMatch(/Chưa đủ lịch hẹn để biết hoá đơn lần đầu/);
  });
});

describe('with no census data it says so instead of estimating', () => {
  const blind = plan({ area: { ...AREA, ok: false, totalPopulation: null, notes: ['Chưa lấy được bảng ngôn ngữ.'] } });

  it('produces no segments and no ceiling', () => {
    expect(blind.segments).toEqual([]);
    expect(blind.primary).toBeNull();
    expect(blind.maxSpendCents).toBeNull();
  });

  it('passes the Census failure through rather than hiding it', () => {
    expect(blind.reasoning.join(' ')).toMatch(/Chưa lấy được bảng ngôn ngữ/);
  });

  it('still states the limits — they do not depend on having data', () => {
    expect(blind.limits.length).toBeGreaterThan(2);
  });
});

describe('a ZIP is never called a five-mile circle', () => {
  it('says it every time', () => {
    expect(plan().limits.join(' ')).toMatch(/không phải một vòng tròn 5 dặm/);
    expect(plan().limits.join(' ')).toMatch(/trung bình 5 năm/);
  });
});
