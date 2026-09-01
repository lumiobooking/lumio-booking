import { money0, count, share, firstSentence } from './plain';
import { buildMarketPlan, type MarketInput } from './market-target';
import type { AreaAudience } from './census-audience';
// buildMarketPlan's blocks carry both languages now (see ./i18n); the
// measurements below are about the Vietnamese wording they always were about.
import { bi, enOf, localizeDeep, viOf } from './i18n';
import type { PlainStep } from './plain';

const fmt = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

describe('money is rounded to what a person would say out loud', () => {
  it('drops the cents on an estimate', () => {
    // The screen was showing "$180.88" and "$22.61". Both are the product of an
    // assumed margin and an averaged ticket; printing them to the cent claims a
    // precision the arithmetic cannot support.
    expect(money0(18_088, fmt)).toBe('$181');
    expect(money0(2_261, fmt)).toBe('$23');
    expect(money0(4_521, fmt)).toBe('$45');
  });

  it('keeps the cents where they change a decision', () => {
    // On a $6.30 service the cents are the price, not noise.
    expect(money0(630, fmt)).toBe('$6.30');
    expect(money0(999, fmt)).toBe('$9.99');
  });

  it('rounds a big number to something memorable', () => {
    expect(money0(184_700, fmt)).toBe('$1850');
  });

  it('survives a non-number instead of printing NaN at a salon', () => {
    expect(money0(NaN, fmt)).toBe('$0');
  });
});

describe('a small share is said in people, not in decimals', () => {
  it('replaces an unpicturable percentage with two real numbers', () => {
    // "0.15% của tệp mục tiêu" is true and produces no mental image at all.
    expect(share(8, 5457)).toBe('8 người trong 5,457');
  });

  it('keeps the percentage once it is big enough to picture', () => {
    expect(share(60, 100)).toBe('60% (60 trong 100)');
    expect(share(1200, 5000)).toBe('24% (1,200 trong 5,000)');
  });

  it('says nothing rather than dividing by zero', () => {
    expect(share(5, 0)).toBe('');
  });

  it('groups thousands so a five-figure count is readable', () => {
    expect(count(22648)).toBe('22,648');
  });
});

describe('the seatbelt on sentence length', () => {
  it('leaves a short line alone', () => {
    expect(firstSentence('Ngắn gọn.')).toBe('Ngắn gọn.');
  });

  it('cuts at a full stop rather than mid-word', () => {
    const long = `${'a'.repeat(80)}. ${'b'.repeat(200)}`;
    expect(firstSentence(long, 120)).toBe(`${'a'.repeat(80)}.`);
  });
});

// ---- the whole block, read as a salon owner would --------------------------

const AREA: AreaAudience = {
  ok: true, year: 2023,
  female: { '18-24': 900, '25-34': 2400, '35-44': 2100, '45-54': 1700, '55-64': 1400, '65+': 1200 },
  male: { '18-24': 950, '25-34': 2500, '35-44': 2000, '45-54': 1600, '55-64': 1300, '65+': 1000 },
  totalPopulation: 27_136, households: 11_000,
  incomeAtLeast: [
    { usd: 75_000, households: 6_600, pct: 60 },
    { usd: 100_000, households: 4_400, pct: 40 },
    { usd: 150_000, households: 2_200, pct: 20 },
  ],
  languages: [],
  notes: [],
};

const INPUT: MarketInput = {
  area: AREA, industry: 'SALON',
  firstVisitTicketCents: 4_521,
  grossMarginPct: 50, cpaCeilingCents: 2_261,
  openSlots: 8, campaignDays: 14,
  city: 'Austin', region: 'TX',
  money: fmt,
};

describe('every block says what it is, then what to do', () => {
  const plan = buildMarketPlan(INPUT);

  it('gives each block a short line — not a paragraph carrying its own method', () => {
    for (const st of plan.steps) {
      expect(viOf(st.line).length).toBeLessThanOrEqual(150);
      expect(viOf(st.title).length).toBeLessThanOrEqual(46);
    }
  });

  it('ends the blocks that need one with a verb', () => {
    // A dashboard that only describes is a dashboard nobody opens twice.
    const withAction = plan.steps.filter((s) => s.action);
    expect(withAction.length).toBeGreaterThanOrEqual(3);
    for (const s of withAction) expect(viOf(s.action).length).toBeGreaterThan(20);
  });

  it('hides the derivation behind "why", it does not delete it', () => {
    // Honesty is not traded for brevity: every claim can still be checked.
    for (const st of plan.steps) expect(viOf(st.why).length).toBeGreaterThan(30);
  });

  it('never prints cents on a derived figure', () => {
    const money = plan.steps.map((s) => `${viOf(s.line)} ${viOf(s.action)}`).join(' ');
    expect(money).not.toMatch(/\$\d+\.\d\d\b/);
  });

  it('never prints a sub-one-percent share', () => {
    // 8 seats out of 5,457 women is 0.15% — a true number nobody can picture.
    const text = plan.steps.map((s) => viOf(s.line)).join(' ');
    expect(text).not.toMatch(/0\.\d+%/);
    expect(text).toMatch(/8 người trong/);
  });

  it('tells an owner with no margin exactly which screen to open', () => {
    const blind = buildMarketPlan({ ...INPUT, cpaCeilingCents: null });
    const budget = blind.steps.find((s) => s.key === 'budget')!;
    expect(viOf(budget.action)).toMatch(/Nhân sự/);
    expect(viOf(budget.line).length).toBeLessThan(60);
  });

  it('keeps the flattened one-liners for the prompt', () => {
    expect(plan.reasoning.length).toBe(plan.steps.length);
    expect(plan.reasoning[0]).toContain('người trưởng thành');
  });
});

describe('a block can hold two languages, and still hold only one', () => {
  // plain.ts owns the SHAPE of an advice block, not its words: the sentences
  // are written by whichever module builds the block. What is checked here is
  // that the shape now carries two languages — and that a builder which has not
  // been converted yet still type-checks and still reads the same either way,
  // which is what lets this migration happen one file at a time.
  const bilingual: PlainStep = {
    key: 'budget', icon: '💰',
    title: bi('Tối đa nên chi', 'The most worth spending'),
    line: bi('$210 trong 14 ngày.', '$210 over 14 days.'),
    action: bi('Bắt đầu nhỏ, đo lại sau 3 ngày.', 'Start small, measure again on day 3.'),
    why: bi('8 chỗ trống × $26 tiền lãi mỗi khách mới.', '8 open seats × $26 of margin per new customer.'),
  };

  it('keeps the two sides apart all the way to the screen', () => {
    expect(enOf(bilingual.title)).not.toBe(viOf(bilingual.title));
    expect(enOf(bilingual.line)).toBe('$210 over 14 days.');
    expect(localizeDeep(bilingual, 'en').action).toBe('Start small, measure again on day 3.');
    expect(localizeDeep(bilingual, 'vi').action).toBe('Bắt đầu nhỏ, đo lại sau 3 ngày.');
  });

  it('still accepts a block nobody has translated yet', () => {
    const untranslated: PlainStep = {
      key: 'market', icon: '📍',
      title: 'Khu vực quanh tiệm', line: '27,136 người trưởng thành.',
      action: null, why: 'Đếm từ điều tra dân số Mỹ.',
    };
    expect(enOf(untranslated.line)).toBe(viOf(untranslated.line));
    expect(localizeDeep(untranslated, 'en').title).toBe('Khu vực quanh tiệm');
  });
});
