import { buildPromoStrategy, strategyApplies, visitProfit, maxSafeDiscount, strategyToPrompt, type StrategyInput } from './promo-strategy';
import { bi, enOf, viOf } from './i18n';
import type { SlotLoad } from './revenue-signals';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 28);
const usd = (c: number) => `$${Math.round(c / 100)}`;
const vnd = (c: number) => `${Math.round(c).toLocaleString('vi-VN')}₫`;

const load = (weekday: number, block: 'morning' | 'afternoon' | 'evening', fillIndex: number): SlotLoad => ({
  weekday, block, minutes: fillIndex * 10, revenueCents: fillIndex * 1000, fillIndex,
  label: bi(`T${weekday + 1} ${block}`, `D${weekday} ${block}`),
});

const US_MENU = [
  { name: 'Gel Manicure', priceCents: 4000, durationMinutes: 45 },
  { name: 'Spa Pedicure', priceCents: 4500, durationMinutes: 50 },
  { name: 'Acrylic Full Set', priceCents: 6000, durationMinutes: 75 },
  { name: 'Nail Art (2 nails)', priceCents: 1000, durationMinutes: 10 },
  { name: 'Paraffin Wax', priceCents: 800, durationMinutes: 10 },
];

/** A year of visits: `n` customers, each coming `k` times, `gap` days apart, last seen `lastDaysAgo`. */
function visits(n: number, k: number, gap: number, lastDaysAgo: number, price = 4000, prefix = 'c') {
  const rows: { customerId: string; at: number; priceCents: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) rows.push({ customerId: `${prefix}${i}`, at: NOW - (lastDaysAgo + j * gap) * DAY, priceCents: price });
  }
  return rows;
}

function base(over: Partial<StrategyInput> = {}): StrategyInput {
  return {
    market: 'US', unit: 100, money: usd, industry: 'SALON',
    commission: { pct: 50, source: 'staff' },
    menu: US_MENU,
    popular: [{ name: 'Gel Manicure', count: 60 }],
    visits: [],
    now: NOW,
    loads: [],
    chairs: 4, openMinutesPerWeek: 60 * 60,
    ...over,
  };
}

describe('what one visit leaves the owner', () => {
  it('takes the tech share, supplies and card fee off the full price', () => {
    // $40, 50% tech, 7% supplies, 3% card → 40 - 20 - 2.8 - 1.2 = $16
    expect(Math.round(visitProfit(4000, { c: 0.5, s: 0.07, f: 0.03 }))).toBe(1600);
  });

  it('assumes the owner absorbs the whole discount (the safe case)', () => {
    // 10% off $40: customer pays 36, fee 1.08, tech still 20, supplies 2.8 → $12.12
    expect(Math.round(visitProfit(4000, { c: 0.5, s: 0.07, f: 0.03 }, 0.1))).toBe(1212);
  });

  it('never allows a discount that keeps less than ~71% of the visit profit', () => {
    for (const c of [0.35, 0.45, 0.5, 0.55, 0.6, 0.7]) {
      const e = { c, s: 0.07, f: 0.03 };
      const d = maxSafeDiscount(4000, e);
      if (d > 0) expect(visitProfit(4000, e, d / 100)).toBeGreaterThanOrEqual(visitProfit(4000, e) / 1.4 - 1e-6);
    }
  });
});

describe('NO programme ever loses money on the visit', () => {
  it('holds for every market, tech share, price level and salon shape', () => {
    const shapes: Partial<StrategyInput>[] = [
      {}, // no history at all
      { visits: visits(200, 6, 25, 5), bookings4w: 200, bookedMinutes4w: 60 * 60 * 4 * 4 * 0.9, loads: [load(1, 'morning', 20), load(2, 'morning', 30), load(5, 'afternoon', 95), load(6, 'morning', 100)] },
      { visits: visits(60, 1, 30, 100), bookings4w: 40, bookedMinutes4w: 60 * 60 * 4 * 4 * 0.2, loads: [load(1, 'morning', 10), load(2, 'afternoon', 20), load(3, 'morning', 50), load(6, 'morning', 100)] },
    ];
    let checked = 0;
    for (const market of ['US', 'CA', 'AU', 'VN']) {
      const vn = market === 'VN';
      for (const pct of [30, 40, 50, 60, 70]) {
        for (const scale of [0.6, 1, 1.8]) {
          for (const shape of shapes) {
            const menu = US_MENU.map((x) => ({ ...x, priceCents: Math.round(x.priceCents * scale * (vn ? 45 : 1)) }));
            const s = buildPromoStrategy(base({
              market, unit: vn ? 1 : 100, money: vn ? vnd : usd, menu,
              commission: { pct, source: 'entered' }, ...shape,
              events: [{ name: bi('Ngày của Mẹ', "Mother's Day"), note: bi('Cao điểm gift card', 'Peak gift card week'), daysAway: 20 }],
            }));
            for (const p of s.programs) {
              expect(p.profitPerUse).toBeGreaterThan(0);
              if (p.key === 'quiet' || p.key === 'combo') expect(p.discountPct).toBeLessThanOrEqual(s.maxSafePct + 1);
              checked++;
            }
            expect(s.programs.length).toBeLessThanOrEqual(3);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('when the tech share eats the whole visit, offers no promotion and says the price is the problem', () => {
    const s = buildPromoStrategy(base({ commission: { pct: 92, source: 'entered' } }));
    expect(s.programs.filter((p) => p.key !== 'raise')).toHaveLength(0);
    expect(s.profitPerVisit).toBeLessThanOrEqual(0);
  });
});

describe('different salons get different plans', () => {
  it('a full, cheap shop is told to raise prices and gets no discount at all', () => {
    const s = buildPromoStrategy(base({
      menu: US_MENU.map((x) => ({ ...x, priceCents: Math.round(x.priceCents * 0.7) })),
      visits: visits(300, 8, 21, 3, 2800),
      bookings4w: 400, bookedMinutes4w: 4 * 60 * 60 * 4 * 0.95,
      loads: [load(1, 'morning', 70), load(3, 'afternoon', 85), load(5, 'afternoon', 95), load(6, 'morning', 100)],
    }));
    expect(s.programs[0].key).toBe('raise');
    expect(s.programs.some((p) => ['quiet', 'first', 'combo'].includes(p.key))).toBe(false);
    expect(viOf(s.headline)).toMatch(/lịch gần kín/);
  });

  it('a new premium studio in a wealthy area gets a gift, not a percentage', () => {
    const s = buildPromoStrategy(base({
      menu: US_MENU.map((x) => ({ ...x, priceCents: x.priceCents * 2 })),
      areaMedianIncomeUsd: 130_000,
      salonAgeDays: 30,
    }));
    const keys = s.programs.map((p) => p.key);
    expect(keys).toContain('first');
    expect(keys).not.toContain('quiet');
    const first = s.programs.find((p) => p.key === 'first')!;
    expect(first.discountPct).toBe(0); // a gift
    expect(enOf(s.facts.find((f) => f.key === 'area')!.value)).toMatch(/above the US average/);
  });

  it('a half-empty shop with clear quiet hours fills those hours, fenced', () => {
    const s = buildPromoStrategy(base({
      visits: visits(180, 5, 28, 6),
      bookings4w: 120, bookedMinutes4w: 4 * 60 * 60 * 4 * 0.5,
      loads: [load(1, 'morning', 15), load(2, 'morning', 25), load(4, 'afternoon', 60), load(5, 'afternoon', 90), load(6, 'morning', 100)],
    }));
    const q = s.programs.find((p) => p.key === 'quiet');
    expect(q).toBeDefined();
    expect(q!.discountPct).toBe(s.maxSafePct);
    expect(viOf(q!.offer)).toContain('T2 morning');
    expect(q!.rules.map(viOf).join(' ')).toMatch(/Không bao giờ áp cho/);
  });

  it('a Vietnamese shop with many lapsed customers wins them back, in đồng rounded to 10.000', () => {
    const vnMenu = [
      { name: 'Sơn gel tay', priceCents: 180_000, durationMinutes: 45 },
      { name: 'Sơn gel chân', priceCents: 200_000, durationMinutes: 45 },
      { name: 'Vẽ móng nghệ thuật', priceCents: 30_000, durationMinutes: 10 },
    ];
    const s = buildPromoStrategy(base({
      market: 'VN', unit: 1, money: vnd, menu: vnMenu,
      commission: { pct: 40, source: 'staff' },
      popular: [{ name: 'Sơn gel tay', count: 80 }],
      visits: [...visits(120, 4, 20, 90, 180_000, 'old'), ...visits(60, 4, 20, 5, 180_000, 'now')],
    }));
    const keys = s.programs.map((p) => p.key);
    expect(keys).toContain('winback');
    for (const p of s.programs) {
      for (const n of `${viOf(p.offer)} ${viOf(p.title)}`.match(/[\d.]+₫/g) ?? []) {
        expect(Number(n.replace(/\D/g, '')) % 10_000).toBe(0);
      }
    }
  });

  it('a gift occasion within six weeks brings the gift card forward', () => {
    const s = buildPromoStrategy(base({
      market: 'AU', money: (c) => `A$${Math.round(c / 100)}`,
      visits: visits(250, 6, 25, 4),
      events: [{ name: bi('Ngày của Mẹ', "Mother's Day"), note: bi('Cao điểm gift card', 'Peak gift card week'), daysAway: 18 }],
    }));
    const g = s.programs.find((p) => p.key === 'prepaid');
    expect(g).toBeDefined();
    expect(enOf(g!.title)).toMatch(/Mother's Day/);
    expect(s.facts.some((f) => f.key === 'season')).toBe(true);
  });

  it('the main programme is not the same for every shop', () => {
    const mains = new Set([
      buildPromoStrategy(base({ salonAgeDays: 20 })),
      buildPromoStrategy(base({ visits: visits(300, 8, 21, 3), bookings4w: 400, bookedMinutes4w: 4 * 60 * 60 * 4 * 0.95 })),
      buildPromoStrategy(base({ visits: visits(180, 5, 28, 6), bookings4w: 120, bookedMinutes4w: 4 * 60 * 60 * 4 * 0.5, loads: [load(1, 'morning', 15), load(2, 'morning', 25), load(5, 'afternoon', 90), load(6, 'morning', 100)] })),
      buildPromoStrategy(base({ visits: [...visits(150, 1, 30, 120, 4000, 'a'), ...visits(40, 3, 30, 200, 4000, 'b')] })),
    ].map((s) => s.programs[0]?.key));
    expect(mains.size).toBeGreaterThanOrEqual(3);
  });
});

describe('plain and honest', () => {
  it('says when the tech share is an estimate, and how to fix it', () => {
    const s = buildPromoStrategy(base({ commission: { pct: null, source: 'assumed' } }));
    expect(viOf(s.missing[0])).toMatch(/Nhân sự/);
    expect(viOf(s.facts.find((f) => f.key === 'profit')!.value)).toMatch(/ước tính/);
  });

  it('only speaks for beauty trades', () => {
    expect(strategyApplies('SALON')).toBe(true);
    expect(strategyApplies('LASH')).toBe(true);
    expect(strategyApplies('RESTAURANT')).toBe(false);
    expect(strategyApplies('REAL_ESTATE')).toBe(false);
  });

  it('never prints [object Object] into the prompt', () => {
    const s = buildPromoStrategy(base({ salonAgeDays: 20 }));
    const text = strategyToPrompt(s, usd);
    expect(text).toMatch(/CHIẾN LƯỢC KHUYẾN MÃI/);
    expect(text).not.toMatch(/\[object Object\]/);
  });

  it('every visible sentence exists in both languages', () => {
    const s = buildPromoStrategy(base({ visits: visits(180, 5, 28, 6), bookings4w: 120, bookedMinutes4w: 4 * 60 * 60 * 4 * 0.5 }));
    for (const p of s.programs) {
      for (const t of [p.title, p.offer, p.why, p.money, p.stopIf, ...p.rules]) {
        expect(viOf(t).length).toBeGreaterThan(5);
        expect(enOf(t).length).toBeGreaterThan(5);
        expect(viOf(t)).not.toBe(enOf(t));
      }
    }
  });
});
