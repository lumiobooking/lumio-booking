import { leadTime, cpaCeiling, budgetPlan, runWindow, adAudiences } from './ads-plan';
import * as adsPlan from './ads-plan';
import { BOOKING_CHANNELS } from '../common/booking-channel';

const DAY = 86_400_000;
const now = Date.UTC(2026, 7, 31);
const booking = (leadDays: number) => ({ createdAt: now - 30 * DAY, startTime: now - 30 * DAY + leadDays * DAY });

describe('how far ahead customers book is measured, not assumed', () => {
  it('takes the median across enough bookings', () => {
    const rows = [1, 2, 3, 3, 3, 4, 4, 5, 6, 7, 3, 3].map(booking);
    expect(leadTime(rows).medianDays).toBe(3);
    expect(leadTime(rows).sample).toBe(12);
  });

  it('is not dragged by one customer booking months out', () => {
    // The reason for a median: one wedding six months ahead would move a mean,
    // and every ad day derived from it, by a week.
    const rows = [...[2, 2, 3, 3, 3, 3, 4, 4, 4, 5].map(booking), booking(120)];
    expect(leadTime(rows).medianDays).toBe(3);
  });

  it('says it does not know below ten bookings', () => {
    const r = leadTime([1, 2, 3].map(booking));
    expect(r.medianDays).toBeNull();
    expect(r.basis).toMatch(/Dưới 10/);
  });

  it('drops impossible gaps rather than averaging them in', () => {
    const rows = [...[3, 3, 3, 3, 3, 3, 3, 3, 3, 3].map(booking), { createdAt: now, startTime: now - 10 * DAY }];
    expect(leadTime(rows).sample).toBe(10);
  });
});

describe('the ceiling comes from the salon’s own ticket and margin', () => {
  it('is ticket times margin — what one visit actually leaves behind', () => {
    // $80 ticket at 40% margin leaves $32. Pay more than that for a booking and
    // the campaign destroys money on every single one.
    const c = cpaCeiling({ avgTicketCents: 8000, grossMarginPct: 40 });
    expect(c.strictCents).toBe(3200);
  });

  it('offers a repeat-adjusted bound but leads with the strict one', () => {
    const c = cpaCeiling({ avgTicketCents: 8000, grossMarginPct: 40, medianGapDays: 60 });
    expect(c.visitsPerYear).toBe(6);
    expect(c.withRepeatCents).toBe(3200 * 6);
    expect(c.plain).toMatch(/Lấy con số ĐẦU/);
  });

  it('caps the repeat multiple — a first click is not a year of loyalty', () => {
    const c = cpaCeiling({ avgTicketCents: 8000, grossMarginPct: 40, medianGapDays: 7 });
    expect(c.visitsPerYear).toBe(6); // not 52
  });

  it('refuses a ceiling when the margin is unknown', () => {
    const c = cpaCeiling({ avgTicketCents: 8000, grossMarginPct: null });
    expect(c.strictCents).toBeNull();
    expect(c.plain).toMatch(/tỷ lệ ăn chia/);
  });

  it('refuses a ceiling when there is no ticket history', () => {
    const c = cpaCeiling({ avgTicketCents: null, grossMarginPct: 40 });
    expect(c.strictCents).toBeNull();
    expect(c.plain).toMatch(/hoá đơn trung bình/);
  });
});

describe('the budget is a test to run, never a forecast', () => {
  const ceiling = cpaCeiling({ avgTicketCents: 8000, grossMarginPct: 40 });

  it('says how many bookings break even, and never how many will arrive', () => {
    const p = budgetPlan({ ceiling, openSlots: 40 });
    // The budget is now derived: 8 conversions × a $32 ceiling, spread over 14
    // days. It used to be a flat $15/day for every business on the platform.
    expect(p.bookingsToBreakEven).toBe(8);
    expect(p.plain).toMatch(/PHÉP ĐO/);
    // The forecast this file refuses to make.
    expect(p.plain).not.toMatch(/sẽ ra|dự kiến sẽ|khoảng \d+ khách sẽ/);
  });

  it('catches a budget that cannot break even in the room available', () => {
    // Needing more customers than there are empty chairs is not ambition.
    const p = budgetPlan({ ceiling, openSlots: 4, dailyCents: 5000, days: 30 });
    expect(p.feasible).toBe('no');
    expect(p.plain).toMatch(/không thể hoà vốn/);
  });

  it('calls it tight when the numbers only just fit', () => {
    expect(budgetPlan({ ceiling, openSlots: 8 }).feasible).toBe('tight');
  });

  it('refuses to size anything without a ceiling', () => {
    const p = budgetPlan({ ceiling: cpaCeiling({ avgTicketCents: null, grossMarginPct: null }) });
    expect(p.feasible).toBe('unknown');
    expect(p.bookingsToBreakEven).toBeNull();
    expect(p.plain).toMatch(/chưa nên bật quảng cáo/);
  });
});

describe('ad days are derived from the booking lead time', () => {
  it('runs BEFORE the quiet day, by however far ahead people book', () => {
    // Saturday (6) is empty and customers book 3 days ahead → advertise Wed.
    const w = runWindow({ quietWeekdays: [6], busyWeekdays: [5], leadDays: 3 });
    expect(w.runDays).toContain(3);
    expect(w.labels.run).toContain('Thứ 4');
    // Advertising on Saturday itself reaches people deciding for next week.
    expect(w.runDays).not.toContain(6);
  });

  it('names the days to switch OFF, which is the half nobody does', () => {
    const w = runWindow({ quietWeekdays: [1], busyWeekdays: [6], leadDays: 2 });
    expect(w.pauseDays.length).toBeGreaterThan(0);
    expect(w.why).toMatch(/đặt trước trung bình 2 ngày/);
  });

  it('never puts a day in both lists', () => {
    const w = runWindow({ quietWeekdays: [2, 3], busyWeekdays: [5, 6], leadDays: 3 });
    for (const d of w.pauseDays) expect(w.runDays).not.toContain(d);
  });

  it('admits the fallback when lead time is unknown', () => {
    const w = runWindow({ quietWeekdays: [6], busyWeekdays: [5], leadDays: null });
    expect(w.why).toMatch(/tạm tính/);
    expect(w.runDays.length).toBeGreaterThan(0);
  });

  it('wraps across the week without producing a negative day', () => {
    const w = runWindow({ quietWeekdays: [1], busyWeekdays: [6], leadDays: 5 });
    for (const d of [...w.runDays, ...w.pauseDays]) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });
});

describe('the platform ranking lives in channel-plan.ts, not here', () => {
  // platformPick() was deleted. It ranked platforms from raw arrival counts and
  // shipped its verdict to the same screen that now shows the ranking built
  // from acquisition and retention. Two rankers is not redundancy, it is a
  // contradiction waiting for the week they disagree — with nothing on screen
  // to tell the owner which card to believe.
  //
  // It also counted keys the booking table never writes ('google', 'gbp',
  // 'organic'), and THESE TESTS PASSED ANYWAY because the fixtures used the
  // same invented keys. A test that agrees with the code rather than with the
  // data proves the code consistent with itself and nothing more.
  it('no longer exports a second platform ranker', () => {
    expect((adsPlan as Record<string, unknown>).platformPick).toBeUndefined();
  });

  it('uses only channel keys the booking table really writes', () => {
    for (const invented of ['google', 'gbp', 'organic']) {
      expect(BOOKING_CHANNELS).not.toContain(invented as never);
    }
    expect(BOOKING_CHANNELS).toContain('gmap');
  });
});

describe('audiences are ranked cheapest first, with the expensive one last', () => {
  const a = adAudiences({ lapsedCount: 40, customerCount: 300, regularCount: 60, city: 'Austin', region: 'TX' });

  it('excludes existing regulars before anything else', () => {
    expect(a[0].name).toMatch(/LOẠI TRỪ/);
    expect(a[0].why).toMatch(/mua lại chính khách của mình/);
  });

  it('puts lapsed customers first among the ones to buy', () => {
    expect(a.find((x) => x.order === 1)?.name).toMatch(/lâu chưa quay lại/);
  });

  it('puts the lookalike LAST, and blocks it below the platform floor', () => {
    const look = a.find((x) => x.name.includes('lookalike'))!;
    expect(look.order).toBe(4);
    expect(look.blockedBy).toMatch(/1\.000 khách/);
    expect(look.why).toMatch(/ĐẮT NHẤT/);
  });

  it('unblocks the lookalike once the list is big enough', () => {
    const big = adAudiences({ customerCount: 1500 });
    expect(big.find((x) => x.name.includes('lookalike'))?.blockedBy).toBeUndefined();
  });

  it('tells a salon with few lapsed customers to message them by hand', () => {
    const few = adAudiences({ lapsedCount: 6, customerCount: 100 });
    const lapsed = few.find((x) => x.order === 1)!;
    expect(lapsed.blockedBy).toMatch(/nhắn tay/);
  });

  it('names the salon’s own town in the radius audience', () => {
    expect(a.find((x) => x.name.includes('quanh tiệm'))?.name).toContain('Austin, TX');
  });
});
