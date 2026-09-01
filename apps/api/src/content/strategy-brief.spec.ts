import { buildStrategyBrief, type BriefInput } from './strategy-brief';
import { bi, enOf, viOf } from './i18n';

/** Every phrase this file produces is bilingual; the specs read one side at a time. */
const viAll = (xs: Parameters<typeof viOf>[0][]) => xs.map(viOf).join(' ');
const enAll = (xs: Parameters<typeof enOf>[0][]) => xs.map(enOf).join(' ');

const money = (c: number) => `$${Math.round(c / 100)}`;

/** A salon with every link in the chain present. */
const FULL: BriefInput = {
  businessLabel: 'Lux Nail Spa',
  declaredWhoWeServe: 'Phụ nữ đi làm quanh Garden Grove',
  serviceArea: 'Garden Grove, CA',
  regionLabel: 'Garden Grove, CA',
  regionKnown: true,
  areaPopulation: 82000,
  areaMedianIncome: 83122,
  areaZipCount: 2,
  censusYear: 2023,
  customerCount: 240,
  segments: [
    { key: 'one-off', label: 'Đến một lần rồi thôi', count: 90, avgTicketCents: 4500, medianGapDays: null, favouriteTime: 'Thứ 7 buổi sáng' },
    { key: 'regular', label: 'Khách quen', count: 60, avgTicketCents: 6000, medianGapDays: 28, favouriteTime: 'Thứ 6 buổi chiều' },
  ],
  lapsedCount: 42,
  audienceThin: false,
  leadDays: 3,
  leadSample: 180,
  quietLabels: ['Thứ 3 buổi sáng', 'Thứ 4 buổi sáng'],
  busyLabels: ['Thứ 7 buổi chiều'],
  sourceCounts: { google: 60, gbp: 20, facebook: 15, walkin: 30, unknown: 25 },
  grossMarginPct: 40,
  cpaCeilingCents: 2400,
  budgetTotalCents: 21000,
  budgetDays: 14,
  bookingsToBreakEven: 9,
  runDayLabels: ['Chủ nhật', 'Thứ 2'],
  pauseDayLabels: ['Thứ 4'],
  money,
};

const strip = (over: Partial<BriefInput>) => buildStrategyBrief({ ...FULL, ...over });
const step = (b: ReturnType<typeof buildStrategyBrief>, k: string) => b.steps.find((s) => s.key === k);
const gap = (b: ReturnType<typeof buildStrategyBrief>, k: string) => b.missing.find((m) => m.key === k);

describe('the brief is a chain, in order', () => {
  const b = buildStrategyBrief(FULL);

  it('runs market → audience → behaviour → channel → value → spend', () => {
    expect(b.steps.map((s) => s.key)).toEqual(['market', 'audience', 'behaviour', 'channel', 'value', 'spend']);
  });

  it('gives every link a number AND where the number came from', () => {
    for (const s of b.steps) {
      expect(viOf(s.finding)).toMatch(/\d/);
      expect(enOf(s.finding)).toMatch(/\d/);
      expect(viOf(s.basis).length).toBeGreaterThan(10);
      expect(viOf(s.soWhat).length).toBeGreaterThan(25);
    }
  });

  it('keeps "what follows" short enough to read on a phone', () => {
    // These lines are the ones an owner acts on. A clause too many and the
    // instruction is lost inside the justification for it.
    for (const s of b.steps) {
      expect(viOf(s.soWhat).length).toBeLessThanOrEqual(200);
      expect(enOf(s.soWhat).length).toBeLessThanOrEqual(200);
    }
  });

  it('never prints cents on a figure derived from a margin', () => {
    const text = b.steps.flatMap((s) => [viOf(s.finding), enOf(s.finding)]).join(' ');
    expect(text).not.toMatch(/\$\d+\.\d\d\b/);
  });

  it('links each step to the next rather than listing facts', () => {
    // The lead time exists in this brief to justify the ad days, and says so.
    expect(viOf(step(b, 'behaviour')!.soWhat)).toMatch(/NGÀY chạy quảng cáo/);
    expect(viOf(step(b, 'channel')!.soWhat)).toMatch(/[Cc]hạy kênh đó trước/);
    expect(viOf(step(b, "value")!.soWhat)).toMatch(/ngưỡng D[ỪừU]NG|ngưỡng dừng/i);
  });

  it('reaches a spending recommendation only when the chain is whole', () => {
    expect(b.complete).toBe(true);
    expect(viOf(step(b, 'spend')!.finding)).toContain('$210');
    expect(viOf(step(b, 'spend')!.finding)).toMatch(/Bật: Chủ nhật, Thứ 2/);
    expect(viOf(step(b, 'spend')!.finding)).toMatch(/Tắt: Thứ 4/);
  });
});

describe('a broken link stops the chain instead of being filled in', () => {
  it('refuses to size spend with no margin, and says what that unlocks', () => {
    const b = strip({ grossMarginPct: null, cpaCeilingCents: null, budgetTotalCents: null });
    expect(b.complete).toBe(false);
    expect(step(b, 'spend')).toBeUndefined();
    expect(viOf(gap(b, 'value')!.unlocks)).toMatch(/không biết mình lãi hay lỗ/);
    expect(viOf(gap(b, 'value')!.how)).toMatch(/tỷ lệ ăn chia/);
  });

  it('never invents a market size when the census is missing', () => {
    const b = strip({ areaPopulation: null });
    expect(step(b, 'market')).toBeUndefined();
    // The number that would have been fabricated must appear nowhere.
    expect(JSON.stringify(b)).not.toMatch(/82,000|82000/);
    expect(viOf(gap(b, 'market')!.how)).toMatch(/ZIP/);
  });

  it('says how many customers it has when it has too few to segment', () => {
    const b = strip({ customerCount: 8, audienceThin: true });
    expect(step(b, 'audience')).toBeUndefined();
    expect(viOf(gap(b, 'audience')!.how)).toContain('8 khách');
  });

  it('refuses a channel verdict off a handful of bookings', () => {
    const b = strip({ sourceCounts: { google: 2, walkin: 3 } });
    expect(step(b, 'channel')).toBeUndefined();
    expect(viOf(gap(b, 'channel')!.how)).toMatch(/5 booking/);
  });

  it('counts the broken links in the headline rather than burying them', () => {
    const b = strip({ areaPopulation: null, grossMarginPct: null, cpaCeilingCents: null, budgetTotalCents: null });
    expect(viOf(b.headline)).toMatch(/thiếu 2 mắt xích/);
    expect(viOf(b.headline)).toMatch(/Chưa đủ căn cứ/);
  });

  it('still recommends spend without a census, but flags the missing context', () => {
    // The ceiling and the ad days come from the salon's own book, not from
    // demographics — so the decision stands. Calling the brief "complete" while
    // the market size is unknown would overstate what it knows.
    const b = strip({ areaPopulation: null });
    expect(b.complete).toBe(true);
    expect(viOf(b.headline)).toMatch(/thiếu 1 mắt xích bối cảnh/);
    expect(viOf(b.headline)).toMatch(/trước khi tăng ngân sách/);
  });

  it('says "chưa nên chi tiền" only when the money links are the missing ones', () => {
    const b = strip({ grossMarginPct: null, cpaCeilingCents: null, budgetTotalCents: null });
    expect(b.complete).toBe(false);
    expect(viOf(b.headline)).toMatch(/Chưa nên chi tiền|Chưa đủ căn cứ/);
  });
});

describe('it says plainly what it cannot know', () => {
  const b = buildStrategyBrief(FULL);

  it('refuses to describe the ethnicity, age or gender of prospects', () => {
    // The Census says what a household earns. It does not say who they are, and
    // a brief that slides from one to the other sounds authoritative while
    // making the whole thing untrustworthy.
    expect(viAll(b.limits)).toMatch(/KHÔNG suy ra thành phần dân tộc/);
    const prose = b.steps.map((s) => `${viOf(s.finding)} ${viOf(s.soWhat)}`).join(' ');
    for (const invented of ['phụ nữ 25-34', 'người gốc', 'chủ yếu là nữ', 'độ tuổi']) {
      expect(prose).not.toContain(invented);
    }
  });

  it('never forecasts bookings from a budget', () => {
    const prose = JSON.stringify(b);
    expect(prose).not.toMatch(/sẽ mang về|dự kiến \d+ khách|ước tính \d+ booking/);
    expect(viAll(b.limits)).toMatch(/Không có dự báo số booking/);
  });

  it('admits a ZIP is not a five-mile circle, every time', () => {
    expect(viAll(b.limits)).toMatch(/không phải một vòng tròn 5 dặm/);
  });

  it('repeats the declared audience rather than deriving one', () => {
    // The business said who it serves; the brief quotes that and does not
    // improve on it.
    expect(viOf(step(b, 'audience')!.finding)).toContain('Phụ nữ đi làm quanh Garden Grove');
    // The declaration is the salon's own sentence, so the English rendering
    // quotes it unchanged instead of translating what a business said.
    expect(enOf(step(b, 'audience')!.finding)).toContain('Phụ nữ đi làm quanh Garden Grove');
    const noDeclaration = strip({ declaredWhoWeServe: null });
    expect(viOf(step(noDeclaration, 'audience')!.finding)).not.toMatch(/mục tiêu:/);
  });
});

describe('the wording follows the numbers, not a template', () => {
  it('reads a high-income area as price-tolerant, and says what follows', () => {
    const rich = strip({ areaMedianIncome: 120_000 });
    expect(viOf(step(rich, 'market')!.soWhat)).toMatch(/[Đđ]ừng cạnh tranh bằng giảm giá/);
  });

  it('does not make that claim about a modest-income area', () => {
    const modest = strip({ areaMedianIncome: 52_000 });
    expect(viOf(step(modest, 'market')!.soWhat)).not.toMatch(/chịu được giá/);
  });

  it('points at the lapsed list when it is big enough to target', () => {
    expect(viOf(step(buildStrategyBrief(FULL), 'audience')!.soWhat)).toMatch(/42 người/);
  });

  it('drops that line when there are too few lapsed customers', () => {
    expect(viOf(step(strip({ lapsedCount: 3 }), 'audience')!.soWhat)).not.toMatch(/rẻ nhất để nhắm/);
  });
});

describe('an estimated margin is never dressed as a measurement', () => {
  it('marks the value step assumed and says so in the finding', () => {
    const b = strip({ marginSource: 'assumed' });
    const v = step(b, 'value')!;
    expect(v.confidence).toBe('assumed');
    expect(viOf(v.finding)).toMatch(/ƯỚC TÍNH/);
    expect(viOf(v.basis)).toMatch(/ƯỚC TÍNH/);
    expect(enOf(v.finding)).toMatch(/ESTIMATE/);
  });

  it('credits the staff records when the rate came from payroll', () => {
    const v = step(strip({ marginSource: 'staff' }), 'value')!;
    expect(v.confidence).toBe('measured');
    expect(viOf(v.basis)).toMatch(/hồ sơ thợ/);
    expect(viOf(v.finding)).not.toMatch(/ƯỚC TÍNH/);
  });

  it('leaves an entered rate unqualified', () => {
    const v = step(strip({ marginSource: 'entered' }), 'value')!;
    expect(v.confidence).toBe('measured');
    expect(viOf(v.basis)).toMatch(/do tiệm khai/);
  });

  it('still reaches a spending recommendation on an assumed margin', () => {
    // Refusing to advise at all was the old behaviour and it helped nobody.
    // The fix is the label, not the silence.
    expect(strip({ marginSource: 'assumed' }).complete).toBe(true);
  });
});

describe('an English reader gets an English brief', () => {
  // The labels reaching the brief are already bilingual. The brief has to carry
  // them through: flattening them to Vietnamese on arrival is what left day
  // names and segment names in Vietnamese inside an English page.
  const b = strip({
    businessLabel: bi('Tiệm nail Lux', 'Lux Nail Spa'),
    segments: [
      {
        key: 'one-off', label: bi('Đến một lần rồi thôi', 'Came once, never came back'),
        count: 90, avgTicketCents: 4500, medianGapDays: null,
        favouriteTime: bi('Thứ 7 buổi sáng', 'Sat morning'),
      },
    ],
    quietLabels: [bi('Thứ 3 buổi sáng', 'Tue morning')],
    busyLabels: [bi('Thứ 7 buổi chiều', 'Sat afternoon')],
    runDayLabels: [bi('Chủ nhật', 'Sunday'), bi('Thứ 2', 'Monday')],
    pauseDayLabels: [bi('Thứ 4', 'Wednesday')],
  });

  it('writes every link in both languages, and they are not the same text', () => {
    for (const s of b.steps) {
      expect(enOf(s.title)).not.toBe(viOf(s.title));
      expect(enOf(s.finding)).not.toBe(viOf(s.finding));
      expect(enOf(s.basis)).not.toBe(viOf(s.basis));
      expect(enOf(s.soWhat)).not.toBe(viOf(s.soWhat));
    }
    expect(enOf(b.headline)).toMatch(/The chain is complete enough to decide what to spend for Lux Nail Spa/);
    expect(viOf(b.headline)).toMatch(/Tiệm nail Lux/);
  });

  it('carries the bilingual labels through instead of flattening them', () => {
    expect(enOf(step(b, 'behaviour')!.finding)).toMatch(/Emptiest blocks: Tue morning/);
    expect(enOf(step(b, 'audience')!.finding)).toMatch(/Came once, never came back/);
    expect(enOf(step(b, 'spend')!.finding)).toMatch(/On: Sunday, Monday/);
    expect(enOf(step(b, 'spend')!.finding)).toMatch(/Off: Wednesday/);
    expect(enOf(step(b, 'behaviour')!.finding)).not.toMatch(/Thứ|Khung/);
  });

  it('says what is missing in English as well', () => {
    const thin = strip({ customerCount: 8, audienceThin: true });
    const g = gap(thin, 'audience')!;
    expect(enOf(g.what)).not.toBe(viOf(g.what));
    expect(enOf(g.how)).toMatch(/8 customers in the book/);
    expect(enAll(b.limits)).toMatch(/ZIP boundaries follow postal routes/);
    expect(enAll(b.limits)).not.toMatch(/dặm|bưu điện/);
  });
});
