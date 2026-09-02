import { buildWeekPlan, filmDay, leadDay, weekPlanToPrompt } from './weekly-plan';
import type { SlotLoad, OfferAdvice, LapsedSignal } from './revenue-signals';
import type { DatedEvent } from './region-events';
import { bi, enOf, viOf } from './i18n';

const load = (weekday: number, block: SlotLoad['block'], fillIndex: number): SlotLoad => ({
  weekday, block, minutes: fillIndex * 10, revenueCents: fillIndex * 1000, fillIndex,
  label: `${['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'][weekday]} ${block === 'morning' ? 'buổi sáng' : block === 'afternoon' ? 'buổi chiều' : 'buổi tối'}`,
});

// slotLoads sorts quietest first; the plan relies on that order.
const BOOK: SlotLoad[] = [
  load(6, 'morning', 15),   // Saturday morning — the gap
  load(1, 'morning', 30),   // Monday morning
  load(3, 'afternoon', 60),
  load(5, 'morning', 92),   // Friday morning — nearly full
  load(6, 'afternoon', 100),
];

const FILL: OfferAdvice = {
  kind: 'fill-slot', headline: 'Ưu đãi giờ vàng', detail: '', discountPct: 20,
  protect: ['Thứ 6 buổi sáng'], basis: 'sổ đặt lịch 60 ngày',
};
const LAPSED: LapsedSignal = { count: 8, medianDaysAway: 52, winBackValueCents: 40_000 };

const plan = (over: Partial<Parameters<typeof buildWeekPlan>[0]> = {}) =>
  buildWeekPlan({ today: new Date('2026-08-30T12:00:00Z'), todayWeekday: 0, industry: 'SALON', loads: BOOK, advice: FILL, lapsed: LAPSED, ...over });

const jobsOn = (p: ReturnType<typeof buildWeekPlan>, wd: number) =>
  p.days.find((d) => d.weekday === wd)!.jobs;
const allJobs = (p: ReturnType<typeof buildWeekPlan>) => p.days.flatMap((d) => d.jobs);

describe('the week is built from the salon’s own book', () => {
  it('films on the salon’s quietest open day', () => {
    // Sunday has no bookings at all in BOOK, so it is treated as closed;
    // Saturday morning is quiet but Saturday afternoon is the peak, so the
    // quietest OPEN day by total load is Monday.
    expect(filmDay(BOOK).weekday).toBe(1);
    expect(filmDay(BOOK).fromData).toBe(true);
    const p = plan();
    expect(jobsOn(p, 1).some((j) => j.kind === 'film')).toBe(true);
  });

  it('never schedules a shoot on a day the salon appears to be closed', () => {
    const p = plan();
    const sunday = jobsOn(p, 0);
    expect(sunday.some((j) => j.kind === 'film')).toBe(false);
  });

  it('publishes the offer two days before the empty slot, not on the day', () => {
    // Saturday (6) is the gap → post on Thursday (4).
    expect(leadDay(6)).toBe(4);
    const offer = jobsOn(plan(), 4).find((j) => j.kind === 'offer');
    expect(offer).toBeTruthy();
    expect(viOf(offer!.text)).toContain('Thứ 7 buổi sáng');
    expect(viOf(offer!.why)).toMatch(/trước 2 ngày/);
  });

  it('names the blocks that must not be discounted', () => {
    const offer = jobsOn(plan(), 4).find((j) => j.kind === 'offer')!;
    expect(viOf(offer.why)).toContain('Thứ 6 buổi sáng');
  });

  it('spaces the three posts instead of stacking them', () => {
    const p = plan();
    const postDays = p.days.filter((d) => d.jobs.some((j) => j.kind === 'post')).map((d) => d.weekday);
    expect(postDays.length).toBe(3);
    expect(new Set(postDays).size).toBe(3);
  });

  it('leaves at least one day genuinely empty', () => {
    const p = plan();
    expect(p.days.some((d) => d.jobs.every((j) => j.kind === 'rest'))).toBe(true);
  });
});

describe('it refuses to discount when the book says not to', () => {
  it('turns a raise-price verdict into a value post, not a sale', () => {
    const raise: OfferAdvice = { kind: 'raise-price', headline: '', detail: 'Lịch gần kín', discountPct: 0, protect: [], basis: '' };
    const p = plan({ advice: raise });
    expect(allJobs(p).some((j) => j.kind === 'offer')).toBe(false);
    const post = allJobs(p).find((j) => viOf(j.why).includes('cho không phần lãi') || viOf(j.text).includes('Không chạy giảm giá'));
    expect(post).toBeTruthy();
    expect(viOf(p.focus)).toMatch(/Giữ giá/);
  });

  it('adds a win-back job only when there are enough lapsed customers', () => {
    expect(allJobs(plan()).some((j) => j.kind === 'winback')).toBe(true);
    const few: LapsedSignal = { count: 1, medianDaysAway: 40, winBackValueCents: 0 };
    expect(allJobs(plan({ lapsed: few })).some((j) => j.kind === 'winback')).toBe(false);
  });
});

describe('an empty book is admitted, not papered over', () => {
  const bare = plan({ loads: [], advice: null, lapsed: null });

  it('says the rhythm is a default', () => {
    expect(bare.dataThin).toBe(true);
    expect(viOf(bare.basis)).toMatch(/Chưa đủ lịch hẹn/);
    const film = allJobs(bare).find((j) => j.kind === 'film')!;
    expect(viOf(film.why)).toMatch(/Chưa đủ dữ liệu/);
  });

  it('still gives a usable week rather than an empty screen', () => {
    expect(bare.days).toHaveLength(7);
    expect(allJobs(bare).filter((j) => j.kind === 'post').length).toBe(3);
  });

  it('never claims a quiet slot it cannot see', () => {
    for (const j of allJobs(bare)) expect(viOf(j.text)).not.toMatch(/CHỈ cho/);
  });
});

describe('the week starts today and covers exactly seven days', () => {
  it.each([0, 1, 3, 5, 6])('starting on weekday %i', (wd) => {
    const p = plan({ todayWeekday: wd });
    expect(p.days).toHaveLength(7);
    expect(p.days[0].weekday).toBe(wd);
    expect(new Set(p.days.map((d) => d.weekday)).size).toBe(7);
  });
});

describe('upcoming local events reach the filming day', () => {
  const ev: DatedEvent[] = [
    { name: 'Tựu trường', date: '2026-09-08', daysAway: 9, spanDays: 10, note: 'Mẹ và con gái làm móng trước ngày đi học', scope: 'regional', precision: 'approximate' },
    { name: 'Halloween', date: '2026-10-31', daysAway: 62, spanDays: 0, note: 'Nail art chủ đề', scope: 'national', precision: 'exact' },
  ];

  it('adds a shoot for what is close, and ignores what is two months out', () => {
    const p = plan({ events: ev });
    const films = jobsOn(p, 1).filter((j) => j.kind === 'film');
    expect(films.some((j) => viOf(j.text).includes('Tựu trường'))).toBe(true);
    expect(films.some((j) => viOf(j.text).includes('Halloween'))).toBe(false);
  });

  it('tells the salon to post before the day, not on it', () => {
    const j = jobsOn(plan({ events: ev }), 1).find((x) => viOf(x.text).includes('Tựu trường'))!;
    expect(viOf(j.why)).toMatch(/trước 5-7 ngày/);
  });
});

describe('daily habits are separate from the dated work', () => {
  it('gives three habits that cost minutes, not hours', () => {
    const p = plan();
    expect(p.daily).toHaveLength(3);
    for (const j of p.daily) expect(j.when).toBeTruthy();
  });

  it('every job explains itself', () => {
    for (const j of [...allJobs(plan()), ...plan().daily]) {
      expect(viOf(j.text).length).toBeGreaterThan(10);
      expect(viOf(j.why).length).toBeGreaterThan(15);
    }
  });
});

describe('the prompt version stays consistent with the screen', () => {
  it('carries the focus, the basis and the dated jobs', () => {
    const text = weekPlanToPrompt(plan());
    expect(text).toContain('TRỌNG TÂM TUẦN NÀY');
    expect(text).toMatch(/căn cứ:/);
    expect(text).toContain('Thứ 5:');
  });

  it('does not list the empty days as work', () => {
    expect(weekPlanToPrompt(plan())).not.toMatch(/Không có việc nội dung/);
  });

  it('stays Vietnamese even though the plan itself is bilingual', () => {
    const text = weekPlanToPrompt(plan({
      stage: {
        key: 'foundation', step: 1,
        title: bi('Nền móng', 'Foundation'),
        goal: bi('Làm dày hồ sơ trước khi bỏ tiền.', 'Build the profile up before spending money.'),
        why: bi('w', 'w-en'), exitWhen: bi('20 đánh giá Google', '20 Google reviews'), progress: null,
        jobs: [{ kind: 'engage', text: bi('Xin đánh giá Google', 'Ask for Google reviews'), why: bi('y', 'y-en') }],
      },
    }));
    // A {vi,en} pair that reaches a template literal prints as [object Object].
    expect(text).not.toMatch(/\[object Object\]/);
    expect(text).toContain('Nền móng');
    expect(text).toContain('Xin đánh giá Google');
    expect(text).not.toContain('Foundation');
  });
});

describe('each trade gets its own week, not a translated nail one', () => {
  it('gives a restaurant restaurant posts', () => {
    const p = plan({ industry: 'RESTAURANT' });
    const posts = allJobs(p).filter((j) => j.kind === 'post').map((j) => viOf(j.text)).join(' ');
    expect(posts).toMatch(/món|bếp|khách thật/i);
    expect(posts).not.toMatch(/móng/i);
  });

  it('gives an estate agency house tours, not manicures', () => {
    const posts = allJobs(plan({ industry: 'REAL_ESTATE' })).filter((j) => j.kind === 'post').map((j) => viOf(j.text)).join(' ');
    expect(posts).toMatch(/tour|nhà|khu vực/i);
    expect(posts).not.toMatch(/móng/i);
  });

  it('gives the three posts three different jobs', () => {
    const posts = allJobs(plan()).filter((j) => j.kind === 'post');
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => viOf(p.why))).size).toBe(3);
  });

  it('names where each day’s raw material comes from, with a time to catch it', () => {
    const p = plan();
    expect(p.sources.length).toBeGreaterThanOrEqual(3);
    for (const s of p.sources) {
      expect(viOf(s.when).length).toBeGreaterThan(3);
      expect(viOf(s.why).length).toBeGreaterThan(15);
    }
    // The single most perishable moment in a nail salon, and the one most
    // often missed: the set is only perfect until the customer stands up.
    expect(viOf(p.sources[0].when)).toMatch(/trước khi khách trả tiền/);
    // The playbook is bilingual now, so the source reaches an English screen
    // in English rather than as Vietnamese inside an English frame.
    expect(enOf(p.sources[0].when)).toMatch(/before she pays/);
  });

  it('gives each trade its own daily habits', () => {
    const salon = plan().daily.map((j) => viOf(j.text)).join(' ');
    const resto = plan({ industry: 'RESTAURANT' }).daily.map((j) => viOf(j.text)).join(' ');
    expect(salon).not.toBe(resto);
    expect(resto).toMatch(/đánh giá|story/i);
  });

  it('falls back to the salon playbook for a trade it does not know', () => {
    const p = plan({ industry: 'SOMETHING_NEW' });
    expect(p.sources.length).toBeGreaterThan(0);
    expect(allJobs(p).filter((j) => j.kind === 'post')).toHaveLength(3);
  });
});

describe('a plan goes somewhere — it is not the same week on repeat', () => {
  /**
   * The complaint this answers: with a steady book and no holiday coming, the
   * week plan was a pure function of (quiet slots, lapsed count, events), so it
   * produced the identical seven days for ever. Film Saturday, post clips
   * 1-2-3, message the lapsed list, repeat until the salon stops opening it.
   */
  const steady = {
    today: new Date('2026-09-01T00:00:00Z'),
    todayWeekday: 1,
    industry: 'SALON',
    loads: [
      { weekday: 4, half: 'pm', label: 'Thứ 5 buổi chiều', minutes: 60, revenueCents: 5000, fillIndex: 10 },
      { weekday: 6, half: 'am', label: 'Thứ 7 buổi sáng', minutes: 600, revenueCents: 50000, fillIndex: 95 },
    ] as never,
    advice: null,
    lapsed: null,
    events: [],
  };

  const clips = (week: number) => buildWeekPlan({ ...steady, week })
    .days.flatMap((d) => d.jobs).filter((j) => j.kind === 'post').map((j) => viOf(j.text));

  it('asks for different clips in week 1 and week 2', () => {
    expect(clips(0)).not.toEqual(clips(1));
  });

  it('runs five distinct weeks before an angle comes round again', () => {
    const seen = new Set([0, 1, 2, 3, 4].map((w) => clips(w).join('|')));
    expect(seen.size).toBe(5);
  });

  it('is the SAME week when opened twice — variety, not randomness', () => {
    // A plan that changed while the owner was reading it would be worse than
    // one that repeated.
    expect(clips(3)).toEqual(clips(3));
  });

  it('takes its focus from the stage, so the aim moves as the shop moves', () => {
    const withStage = buildWeekPlan({
      ...steady,
      stage: {
        key: 'foundation', step: 1, title: 'Nền móng',
        goal: 'Làm dày hồ sơ trước khi bỏ tiền.',
        why: 'w', exitWhen: 'x', progress: null,
        jobs: [{ kind: 'engage', text: 'Xin đánh giá Google', why: 'y' }],
      },
    });
    expect(viOf(withStage.focus)).toMatch(/Nền móng/);
    expect(withStage.stage!.step).toBe(1);
    // The stage's own work is IN the week, not in a separate list nobody reads.
    expect(withStage.days.flatMap((d) => d.jobs).map((j) => viOf(j.text))).toContain('Xin đánh giá Google');
  });

  it('still works for a salon with no stage at all', () => {
    const p = buildWeekPlan(steady);
    expect(p.stage).toBeNull();
    expect(viOf(p.focus).length).toBeGreaterThan(10);
  });

  it('carries the stage’s English into the week instead of stopping at the boundary', () => {
    // The stage is bilingual; the week used to unwrap it to Vietnamese on the
    // way in, so an English screen showed a Vietnamese aim and Vietnamese jobs.
    const withStage = buildWeekPlan({
      ...steady,
      stage: {
        key: 'foundation', step: 1,
        title: bi('Nền móng', 'Foundation'),
        goal: bi('Làm dày hồ sơ trước khi bỏ tiền.', 'Build the profile up before spending money.'),
        why: bi('w', 'w-en'), exitWhen: bi('x', 'x-en'), progress: null,
        jobs: [{ kind: 'engage', text: bi('Xin đánh giá Google', 'Ask for Google reviews'), why: bi('y', 'y-en') }],
      },
    });
    expect(enOf(withStage.focus)).toBe('Foundation — Build the profile up before spending money.');
    expect(enOf(withStage.focus)).not.toBe(viOf(withStage.focus));
    expect(withStage.days.flatMap((d) => d.jobs).map((j) => enOf(j.text))).toContain('Ask for Google reviews');
  });
});

describe('the same week reads in English', () => {
  it('gives the days, the aim, the basis and the jobs an English side of their own', () => {
    const p = plan();
    const saturday = p.days.find((d) => d.weekday === 6)!;
    expect(enOf(saturday.label)).toBe('Saturday');
    expect(viOf(saturday.label)).toBe('Thứ 7');

    expect(enOf(p.basis)).toMatch(/own book/);
    expect(enOf(p.basis)).not.toBe(viOf(p.basis));
    expect(enOf(p.focus)).toMatch(/emptiest block/);
    expect(enOf(p.focus)).not.toBe(viOf(p.focus));

    const film = allJobs(p).find((j) => j.kind === 'film')!;
    expect(enOf(film.text)).toMatch(/Film all 3 clips/);
    expect(enOf(film.why)).not.toBe(viOf(film.why));

    const offer = jobsOn(p, 4).find((j) => j.kind === 'offer')!;
    expect(enOf(offer.text)).toMatch(/20% offer/);
    expect(enOf(offer.text)).not.toBe(viOf(offer.text));

    // A rest day is a phrase the product writes, so it is translated too.
    const rest = allJobs(p).find((j) => j.kind === 'rest')!;
    expect(enOf(rest.text)).toMatch(/No content work today/);

    // The post lines are built out of the trade playbook. They read as English
    // here only because the playbook itself carries both languages — before it
    // did, this line put a Vietnamese post title inside an English sentence.
    const post = allJobs(p).find((j) => j.kind === 'post')!;
    expect(enOf(post.text)).toMatch(/^Post clip \d — \w/);
    expect(enOf(post.text)).not.toBe(viOf(post.text));
    expect(enOf(post.why)).not.toBe(viOf(post.why));
  });
});

describe('the plan reads its own scorecard', () => {
  const plan = (over: Partial<Parameters<typeof buildWeekPlan>[0]> = {}) =>
    buildWeekPlan({ today: new Date('2026-08-30T12:00:00Z'), todayWeekday: 0, industry: 'SALON', loads: BOOK, advice: FILL, lapsed: LAPSED, ...over });

  const postJobs = (p: ReturnType<typeof buildWeekPlan>) =>
    p.days.flatMap((d) => d.jobs).filter((j) => j.kind === 'post');

  it('says nothing on the very first week — there is nothing to report', () => {
    expect(plan().report).toBeNull();
  });

  it('keeps three posts and says so when last week held the rhythm', () => {
    const p = plan({ lastWeek: { planned: 5, done: 4, posted: 3 } });
    expect(postJobs(p)).toHaveLength(3);
    expect(viOf(p.report!)).toContain('4/5');
  });

  it('trims to two posts when last week collapsed, and admits why', () => {
    const p = plan({ lastWeek: { planned: 6, done: 1, posted: 0 } });
    expect(postJobs(p)).toHaveLength(2);
    expect(viOf(p.report!)).toContain('rút còn 2');
    expect(enOf(p.report!)).toContain('trimmed to 2');
  });

  it('never punishes a tiny plan — one missed job out of two is not a collapse', () => {
    const p = plan({ lastWeek: { planned: 2, done: 1, posted: 1 } });
    expect(postJobs(p)).toHaveLength(3);
  });
});
