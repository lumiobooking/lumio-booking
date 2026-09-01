import { buildMarketPlan, type MarketInput } from './market-target';
import type { AreaAudience } from './census-audience';
import { enOf, viOf } from './i18n';

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
    expect(viOf(p.primary!.basis)).toMatch(/B01001/);
  });

  it('reasons outward-in: market, then target, then price, then capacity, then money', () => {
    // The ORDER is the argument. Assert the sequence of blocks rather than the
    // wording inside them, so rewriting a sentence for clarity does not fail a
    // test that is about structure.
    expect(p.steps.map((s) => s.key)).toEqual(['market', 'target', 'price', 'capacity', 'budget']);
  });

  it('gives targeting anyone can type into the ad platform', () => {
    const t = p.primary!.targeting.map(viOf).join(' ');
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
    expect(viOf(p.primary!.label)).toMatch(/tiếng Việt/);
    expect(p.primary!.targeting.map(viOf).join(' ')).toMatch(/Ngôn ngữ = Vietnamese/);
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
    expect(viOf(p.primary!.why)).toMatch(/Chưa có căn cứ để thu hẹp/);
  });
});

describe('penetration replaces the market-share figure it refuses to invent', () => {
  it('says what share of the target the empty chairs represent', () => {
    const p = plan();
    // 20 seats out of 6,200 women 25-54 = 0.32% — a true number nobody can
    // picture, so the line says "20 người trong 6,200" instead.
    expect(p.penetrationPct).toBe(0.32);
    expect(p.penetrationVerdict).toBe('easy');
    const cap = p.steps.find((s) => s.key === 'capacity')!;
    expect(viOf(cap.line)).toMatch(/20 người trong 6,200/);
    expect(viOf(cap.action)).toMatch(/tầm với/);
  });

  it('calls it impossible when the chairs outnumber what the segment can feed', () => {
    const p = plan({ openSlots: 900 });
    expect(p.penetrationVerdict).toBe('impossible');
    const cap = p.steps.find((s) => s.key === 'capacity')!;
    // The action must be the cheap move, not "spend more".
    expect(viOf(cap.action)).toMatch(/khách cũ quay lại/);
    expect(viOf(cap.why)).toMatch(/mở rộng bán kính/);
  });

  it('never claims a market share', () => {
    const text = JSON.stringify(plan());
    expect(text).not.toMatch(/thị phần \d|chiếm được \d+% thị trường/);
    expect(plan().limits.map(viOf).join(' ')).toMatch(/KHÔNG có dữ liệu đối thủ/);
  });
});

describe('the budget ceiling comes from capacity × margin, and says it is a ceiling', () => {
  it('multiplies the seats it can fill by what a new customer is worth', () => {
    expect(plan().maxSpendCents).toBe(20 * 2_250);
    const b = plan().steps.find((s) => s.key === 'budget')!;
    // The line carries the number; the "start small, measure, then scale"
    // procedure is the ACTION, where an owner will actually look for it.
    expect(viOf(b.line)).toMatch(/\$450/);
    expect(viOf(b.action)).toMatch(/Bắt đầu nhỏ/);
    expect(viOf(b.action)).toMatch(/Sau 3 ngày/);
  });

  it('explains why spending past it cannot pay back — in the working, not the headline', () => {
    const b = plan().steps.find((s) => s.key === 'budget')!;
    expect(viOf(b.why)).toMatch(/không còn ghế trống để ngồi/);
    expect(viOf(b.line).length).toBeLessThan(110);
  });

  it('refuses a ceiling without a margin, and points at one screen', () => {
    const p = plan({ cpaCeilingCents: null });
    expect(p.maxSpendCents).toBeNull();
    const b = p.steps.find((s) => s.key === 'budget')!;
    expect(viOf(b.action)).toMatch(/Nhân sự → sửa thợ/);
    expect(viOf(b.why)).toMatch(/Dân số nói được nhắm vào ai/);
  });

  it('never forecasts bookings from a budget', () => {
    expect(JSON.stringify(plan())).not.toMatch(/sẽ mang về|dự kiến \d+ khách|ước tính \d+ booking/);
  });
});

describe('price is read against the area, not against a feeling', () => {
  it('calls a low ticket in a rich area an upsell opportunity, not a discount one', () => {
    const price = plan({ firstVisitTicketCents: 4_000 }).steps.find((s) => s.key === 'price')!;
    expect(viOf(price.action)).toMatch(/Đừng giảm giá/);
    expect(viOf(price.action)).toMatch(/nâng cấp/);
  });

  it('picks the income line from the shop’s own ticket', () => {
    // A $200 first visit is judged against $150k households, not $75k ones.
    expect(plan({ firstVisitTicketCents: 20_000 }).affordable!.usd).toBe(150_000);
    expect(plan({ firstVisitTicketCents: 3_000 }).affordable!.usd).toBe(75_000);
  });

  it('says so plainly when it has no ticket to compare, and offers no advice it cannot support', () => {
    const price = plan({ firstVisitTicketCents: null }).steps.find((s) => s.key === 'price')!;
    expect(price.action).toBeNull();
    expect(viOf(price.why)).toMatch(/Chưa đủ lịch hẹn/);
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
    expect(plan().limits.map(viOf).join(' ')).toMatch(/không phải một vòng tròn 5 dặm/);
    expect(plan().limits.map(viOf).join(' ')).toMatch(/trung bình 5 năm/);
  });
});

describe('the same market, for an owner reading English', () => {
  it('writes every phrase twice instead of leaving one side in Vietnamese', () => {
    const p = plan();
    expect(enOf(p.primary!.label)).not.toBe(viOf(p.primary!.label));
    expect(enOf(p.primary!.label)).toMatch(/Women 25–54 around Austin, TX/);
    expect(enOf(p.primary!.basis)).toMatch(/US Census Bureau, table B01001/);
    expect(p.primary!.targeting.map(enOf).join(' ')).toMatch(/Meta: Women, 25–54, a 5-mile radius/);
    expect(p.limits.map(enOf).join(' ')).toMatch(/not a 5-mile circle/);
  });

  it('says the money and the arithmetic in English word order', () => {
    const p = plan();
    const b = p.steps.find((s) => s.key === 'budget')!;
    expect(enOf(b.line)).toMatch(/\$450 — and only if each new customer costs under \$23\./);
    expect(enOf(b.action)).toMatch(/^Start small\. After 3 days/);
    expect(enOf(b.why)).toMatch(/20 open slots × \$23 of profit per new customer = \$450\./);

    const cap = p.steps.find((s) => s.key === 'capacity')!;
    // Below one percent the count reads better than the percentage — in both.
    expect(enOf(cap.line)).toMatch(/Room for 20 new customers in 14 days — that takes 20 people out of 6,200\./);

    const price = p.steps.find((s) => s.key === 'price')!;
    expect(enOf(price.line)).toMatch(/60% of households here earn over \$75,000 a year/);
    expect(enOf(price.line)).not.toMatch(/hộ|thu nhập/);
  });

  it('leaves the flattened prompt lines in Vietnamese whichever language the screen is in', () => {
    const text = plan().reasoning.join(' ');
    expect(text).toContain('người trưởng thành');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('adults live in');
  });
});
