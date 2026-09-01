import { buildWeekOutcome, describeOutcome, describeDelta, type OutcomeInput } from './week-outcome';
import { enOf, viOf } from './i18n';

const money = (c: number) => `$${Math.round(c / 100)}`;
const book = (n: number, firsts = 0, price = 5000) =>
  Array.from({ length: n }, (_, i) => ({ priceCents: price, isFirstVisit: i < firsts }));

const BASE: OutcomeInput = {
  weekKey: '2026-W35',
  bookings: book(22, 6),
  prevBookings: book(18, 4),
  reviews: 3,
  prevReviews: 1,
  plannedJobs: 8,
  ideas: [
    { status: 'posted', postedUrl: 'https://facebook.com/p/1' },
    { status: 'posted', postedUrl: null },
    { status: 'filmed' },
    { status: 'skipped' },
    { status: 'published' },
  ],
};
const out = (over: Partial<OutcomeInput> = {}) => buildWeekOutcome({ ...BASE, ...over });

describe('a week is recorded by what it produced, not only by what was planned', () => {
  const o = out();

  it('counts the work that was actually done against the work that was asked for', () => {
    // The archive used to hold intentions and nothing else: open week 35 and
    // you saw what was meant to happen, never what did.
    expect(o.plannedJobs).toBe(8);
    expect(o.doneJobs).toBe(3); // two posted + one filmed; skipped is not done
  });

  it('counts a post as verifiable only when it carries a link', () => {
    expect(o.posted).toBe(2);
    expect(o.postedWithLink).toBe(1);
  });

  it('carries the salon’s own numbers for that week', () => {
    expect(o.bookings).toBe(22);
    expect(o.newCustomers).toBe(6);
    expect(o.revenueCents).toBe(22 * 5000);
    expect(o.reviews).toBe(3);
  });
});

describe('the comparison is week-on-week, and only when there is a week to compare', () => {
  it('reports the change against the week before', () => {
    const o = out();
    expect(o.delta.bookings).toBe(4);
    expect(o.delta.newCustomers).toBe(2);
    expect(o.delta.reviews).toBe(2);
  });

  it('refuses a delta for a salon’s first week', () => {
    // Treating an absent week as zero would report a first week as infinite
    // growth — exactly the number that gets screenshotted and repeated.
    const o = out({ prevBookings: null, prevReviews: null });
    expect(o.delta.bookings).toBeNull();
    expect(o.delta.newCustomers).toBeNull();
    expect(o.delta.reviews).toBeNull();
    expect(viOf(describeDelta(o))).toBe('');
    expect(enOf(describeDelta(o))).toBe('');
  });

  it('reports a fall as plainly as a rise', () => {
    const o = out({ bookings: book(10, 1), prevBookings: book(20, 5) });
    expect(o.delta.bookings).toBe(-10);
    expect(viOf(describeDelta(o))).toContain('-10 booking');
    expect(enOf(describeDelta(o))).toContain('-10 bookings');
  });

  it('says nothing rather than "0" when a figure did not move', () => {
    const o = out({ bookings: book(18, 4), prevBookings: book(18, 4), reviews: 1, prevReviews: 1 });
    expect(viOf(describeDelta(o))).toBe('');
  });
});

describe('it never claims the work caused the numbers', () => {
  it('puts the work and the result side by side, with no arrow between them', () => {
    // Nothing in this data can support "the Thursday post brought six
    // customers" — a booking on Thursday might have come from the post, the
    // sign outside, or a friend. A number that looks like attribution and is
    // not is worse than none, because somebody spends money on it.
    const line = viOf(describeOutcome(out(), money));
    expect(line).toMatch(/làm 3\/8 việc/);
    expect(line).toMatch(/22 booking/);
    expect(line).not.toMatch(/nhờ|do bài|mang về|giúp tăng/);
  });

  it('reads as one line a salon owner can take in', () => {
    expect(viOf(describeOutcome(out(), money)).length).toBeLessThan(90);
    expect(enOf(describeOutcome(out(), money)).length).toBeLessThan(90);
  });

  it('leaves out what did not happen instead of printing zeros', () => {
    const line = viOf(describeOutcome(out({ reviews: 0, ideas: [], plannedJobs: 0 }), money));
    expect(line).not.toMatch(/0 đánh giá|0\/0/);
    expect(line).toMatch(/22 booking/);
  });
});

describe('the counting rules that stop a quiet week looking like a failed one', () => {
  it('does not count rest days as work that was skipped', () => {
    // plannedJobs is passed in already excluding rest days — the guard is that
    // a week with nothing planned reports 0/0, not 0 out of seven.
    const o = out({ plannedJobs: 0, ideas: [] });
    expect(o.plannedJobs).toBe(0);
    expect(o.doneJobs).toBe(0);
  });

  it('never returns a negative planned count from bad input', () => {
    expect(out({ plannedJobs: -3 }).plannedJobs).toBe(0);
  });
});

describe('the same week reads in English without changing what it claims', () => {
  it('writes both languages whole, plurals included', () => {
    const line = describeOutcome(out(), money);
    expect(viOf(line)).toBe('làm 3/8 việc · 22 booking · 6 khách mới · $1100 · 3 đánh giá');
    expect(enOf(line)).toBe('3 of 8 jobs done · 22 bookings · 6 new customers · $1100 · 3 reviews');
    expect(enOf(line)).not.toBe(viOf(line));

    const one = describeOutcome(out({ bookings: book(1, 1), reviews: 1 }), money);
    expect(enOf(one)).toContain('1 booking ');
    expect(enOf(one)).toContain('1 new customer ');
    expect(enOf(one)).toContain('1 review');
  });

  it('states the week-on-week change in English, with no arrow drawn', () => {
    const d = describeDelta(out());
    expect(viOf(d)).toBe('+4 booking, +2 khách mới, +2 đánh giá so với tuần trước');
    expect(enOf(d)).toBe('+4 bookings, +2 new customers, +2 reviews vs the week before');
    expect(enOf(d)).not.toMatch(/because|thanks to|drove|led to/);
  });
});
