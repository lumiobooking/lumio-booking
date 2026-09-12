import {
  adCapacity, isFull, openMinutesPerWeek,
  ASSUMED_OPEN_MINUTES_PER_WEEK, MIN_HISTORY_DAYS, FULL_PCT,
} from './ad-capacity';

const WEEK = 6 * 9 * 60; // open 9h a day, six days
const base = { openMinutesPerWeek: WEEK, chairs: 4, slotMinutes: 60, campaignDays: 14 };

/**
 * The bug this file was written for, stated as a test.
 *
 * A salon mid-setup was shown "your quiet hours only hold 0" and told not to
 * advertise. It was nearly empty. The old figure measured the GAP between the
 * busiest weekday and the quietest ones, so a salon with two appointments a
 * day every day produced zero — identical to a salon booked solid.
 */
describe('an empty salon has every chair free, not none', () => {
  it('gives a brand-new salon its whole capacity', () => {
    const c = adCapacity({ ...base, bookedMinutes: 0, historyDays: 3 });
    // 6 days x 9h x 4 chairs x 2 weeks = 432 hours of chair time.
    expect(c.slots).toBe(432);
    expect(c.utilisationPct).toBe(0);
    expect(c.basis).toBe('measured');
  });

  it('does not read a thin booking history as an empty diary OR a full one', () => {
    // Ten days of history with a little in it: not enough to subtract from
    // capacity, and the safe reading is the one that does not refuse a campaign.
    const thin = adCapacity({ ...base, bookedMinutes: 900, historyDays: 10 });
    const none = adCapacity({ ...base, bookedMinutes: 0, historyDays: 0 });
    expect(thin.slots).toBe(none.slots);
    expect(MIN_HISTORY_DAYS).toBe(14);
  });

  it('starts counting the book once there are two weeks of it', () => {
    const c = adCapacity({ ...base, bookedMinutes: 60 * 100, historyDays: 28 });
    // 100 chair-hours over 28 days → 50 over the 14-day campaign.
    expect(c.slots).toBe(432 - 50);
    expect(c.utilisationPct).toBe(12);
  });

  it('TELLS THE TWO ZEROS APART — empty and full are no longer the same number', () => {
    const empty = adCapacity({ ...base, bookedMinutes: 0, historyDays: 60 });
    const full = adCapacity({ ...base, bookedMinutes: WEEK * 4 * (60 / 7), historyDays: 60 });
    expect(empty.utilisationPct).toBe(0);
    expect(full.utilisationPct).toBe(100);
    expect(isFull(empty)).toBe(false);
    expect(isFull(full)).toBe(true);
    expect(full.slots).toBe(0);
  });
});

describe('what it says when it does not know', () => {
  it('returns null rather than zero when nobody works here yet', () => {
    const c = adCapacity({ ...base, chairs: null, bookedMinutes: 0, historyDays: 30 });
    expect(c.slots).toBeNull();
    expect(c.utilisationPct).toBeNull();
    expect(c.basis).toBe('unknown');
    expect(c.missing).toContain('chairs');
  });

  it('treats zero staff as "not set up", not as "no capacity"', () => {
    expect(adCapacity({ ...base, chairs: 0 }).slots).toBeNull();
  });

  it('falls back to a modest assumed week when the hours are not filled in, and says so', () => {
    const c = adCapacity({ ...base, openMinutesPerWeek: null, bookedMinutes: 0, historyDays: 30 });
    expect(c.basis).toBe('assumed-hours');
    expect(c.missing).toEqual(['hours']);
    expect(c.slots).toBe((ASSUMED_OPEN_MINUTES_PER_WEEK * 4 * 2) / 60);
  });

  it('assumes LOW, so a guess never makes a salon look emptier than it is', () => {
    // A high assumption would wave through campaigns with nowhere to put the
    // people. Six eight-hour days is under a real salon week on purpose.
    expect(ASSUMED_OPEN_MINUTES_PER_WEEK).toBeLessThan(WEEK);
  });

  it('NEVER reports 0 slots from missing data — that is the whole point', () => {
    const starved = [
      { ...base, chairs: null },
      { ...base, chairs: 0 },
      { ...base, chairs: undefined },
    ];
    for (const s of starved) expect(adCapacity(s).slots).not.toBe(0);
  });
});

describe('reading the salon’s own opening hours', () => {
  const day = (open: number, close: number) => ({ closed: false, openMinutes: open, closeMinutes: close });

  it('adds up the week', () => {
    const hours = [{ closed: true, openMinutes: 0, closeMinutes: 0 }, ...Array(6).fill(day(9 * 60, 18 * 60))];
    expect(openMinutesPerWeek(hours)).toBe(6 * 9 * 60);
  });

  it('uses split shifts when a shop has them', () => {
    const split = [{ closed: false, openMinutes: 630, closeMinutes: 1230, intervals: [{ open: 630, close: 870 }, { open: 990, close: 1230 }] }];
    expect(openMinutesPerWeek(split)).toBe(240 + 240);
  });

  it('says null for a salon that has not set any, rather than zero', () => {
    expect(openMinutesPerWeek(null)).toBeNull();
    expect(openMinutesPerWeek([])).toBeNull();
    expect(openMinutesPerWeek(Array(7).fill({ closed: true, openMinutes: 0, closeMinutes: 0 }))).toBeNull();
  });

  it('ignores a backwards or empty window instead of going negative', () => {
    expect(openMinutesPerWeek([day(1200, 600), day(9 * 60, 17 * 60)])).toBe(8 * 60);
  });
});

describe('the threshold that stops a genuinely full salon', () => {
  it('is a high bar, so a busy salon is not refused for being busy', () => {
    expect(FULL_PCT).toBeGreaterThanOrEqual(90);
    const busy = adCapacity({ ...base, bookedMinutes: WEEK * 4 * (60 / 7) * 0.8, historyDays: 60 });
    expect(busy.utilisationPct).toBe(80);
    expect(isFull(busy)).toBe(false);
    expect(busy.slots).toBeGreaterThan(0);
  });
});
