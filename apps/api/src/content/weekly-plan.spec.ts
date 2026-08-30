import { buildWeekPlan, filmDay, leadDay, weekPlanToPrompt } from './weekly-plan';
import type { SlotLoad, OfferAdvice, LapsedSignal } from './revenue-signals';
import type { DatedEvent } from './region-events';

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
    expect(offer!.text).toContain('Thứ 7 buổi sáng');
    expect(offer!.why).toMatch(/trước 2 ngày/);
  });

  it('names the blocks that must not be discounted', () => {
    const offer = jobsOn(plan(), 4).find((j) => j.kind === 'offer')!;
    expect(offer.why).toContain('Thứ 6 buổi sáng');
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
    const post = allJobs(p).find((j) => j.why.includes('cho không phần lãi') || j.text.includes('Không chạy giảm giá'));
    expect(post).toBeTruthy();
    expect(p.focus).toMatch(/Giữ giá/);
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
    expect(bare.basis).toMatch(/Chưa đủ lịch hẹn/);
    const film = allJobs(bare).find((j) => j.kind === 'film')!;
    expect(film.why).toMatch(/Chưa đủ dữ liệu/);
  });

  it('still gives a usable week rather than an empty screen', () => {
    expect(bare.days).toHaveLength(7);
    expect(allJobs(bare).filter((j) => j.kind === 'post').length).toBe(3);
  });

  it('never claims a quiet slot it cannot see', () => {
    for (const j of allJobs(bare)) expect(j.text).not.toMatch(/CHỈ cho/);
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
    expect(films.some((j) => j.text.includes('Tựu trường'))).toBe(true);
    expect(films.some((j) => j.text.includes('Halloween'))).toBe(false);
  });

  it('tells the salon to post before the day, not on it', () => {
    const j = jobsOn(plan({ events: ev }), 1).find((x) => x.text.includes('Tựu trường'))!;
    expect(j.why).toMatch(/trước 5-7 ngày/);
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
      expect(j.text.length).toBeGreaterThan(10);
      expect(j.why.length).toBeGreaterThan(15);
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
});

describe('each trade gets its own week, not a translated nail one', () => {
  it('gives a restaurant restaurant posts', () => {
    const p = plan({ industry: 'RESTAURANT' });
    const posts = allJobs(p).filter((j) => j.kind === 'post').map((j) => j.text).join(' ');
    expect(posts).toMatch(/món|bếp|khách thật/i);
    expect(posts).not.toMatch(/móng/i);
  });

  it('gives an estate agency house tours, not manicures', () => {
    const posts = allJobs(plan({ industry: 'REAL_ESTATE' })).filter((j) => j.kind === 'post').map((j) => j.text).join(' ');
    expect(posts).toMatch(/tour|nhà|khu vực/i);
    expect(posts).not.toMatch(/móng/i);
  });

  it('gives the three posts three different jobs', () => {
    const posts = allJobs(plan()).filter((j) => j.kind === 'post');
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.why)).size).toBe(3);
  });

  it('names where each day’s raw material comes from, with a time to catch it', () => {
    const p = plan();
    expect(p.sources.length).toBeGreaterThanOrEqual(3);
    for (const s of p.sources) {
      expect(s.when.length).toBeGreaterThan(3);
      expect(s.why.length).toBeGreaterThan(15);
    }
    // The single most perishable moment in a nail salon, and the one most
    // often missed: the set is only perfect until the customer stands up.
    expect(p.sources[0].when).toMatch(/trước khi khách trả tiền/);
  });

  it('gives each trade its own daily habits', () => {
    const salon = plan().daily.map((j) => j.text).join(' ');
    const resto = plan({ industry: 'RESTAURANT' }).daily.map((j) => j.text).join(' ');
    expect(salon).not.toBe(resto);
    expect(resto).toMatch(/đánh giá|story/i);
  });

  it('falls back to the salon playbook for a trade it does not know', () => {
    const p = plan({ industry: 'SOMETHING_NEW' });
    expect(p.sources.length).toBeGreaterThan(0);
    expect(allJobs(p).filter((j) => j.kind === 'post')).toHaveLength(3);
  });
});
