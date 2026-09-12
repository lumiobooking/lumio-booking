import {
  adCapacity, isFull, openMinutesPerWeek, openDaysPerWeek,
  ASSUMED_OPEN_MINUTES_PER_WEEK, MIN_HISTORY_DAYS, FULL_PCT,
  ADS_SHARE, EXTRA_PER_CHAIR_DAY,
} from './ad-capacity';

const WEEK = 6 * 9 * 60; // open 9h a day, six days
const base = { openMinutesPerWeek: WEEK, chairs: 4, slotMinutes: 60, campaignDays: 14 };

/**
 * THE NUMBER HAS TO SURVIVE BEING SAID OUT LOUD TO A SALON OWNER.
 *
 * Two versions of this have now been wrong in opposite directions. The first
 * measured the gap between weekdays and told a nearly-empty salon it had room
 * for 0. The second measured open hours x chairs and told a five-technician
 * salon it had room for 717 — arithmetically true, and the answer you get if
 * every chair is busy every open minute for a fortnight.
 *
 * The figure is quoted by an agency to its client, so the bar is not "can it be
 * derived" but "will the owner nod". These tests hold it to that.
 */
describe('the figure an owner is asked to believe', () => {
  it('is the one an owner would have guessed: one more customer per tech per day', () => {
    const c = adCapacity({ ...base, bookedMinutes: 0, historyDays: 3 });
    expect(c.slots).toBe(4 * 14 * EXTRA_PER_CHAIR_DAY);
    expect(c.slots).toBe(56);
  });

  it('NEVER returns the raw chair-time — the 717 that started this', () => {
    // Five techs, open ten hours a day, seven days: the unsafe figure is 700.
    const c = adCapacity({
      openMinutesPerWeek: 7 * 10 * 60, chairs: 5, slotMinutes: 60,
      campaignDays: 14, bookedMinutes: 0, historyDays: 0,
    });
    expect(c.slots).toBe(70);
    expect(c.slots).toBeLessThan(100);
  });

  it('asks one campaign to fill only a quarter of the genuinely free time', () => {
    // A salon at 85% has little free time, and there the share is what bites
    // rather than the per-tech cap — the campaign is sized to a quarter of what
    // is actually free, not to all of it.
    const booked = WEEK * 4 * (14 / 7) * 0.85;
    const c = adCapacity({ ...base, bookedMinutes: booked * (60 / 14), historyDays: 60 });
    const freeMinutes = WEEK * 4 * 2 - booked;
    expect(c.slots).toBe(Math.floor((freeMinutes * ADS_SHARE) / 60));
    expect(c.slots).toBeLessThan(4 * 14 * EXTRA_PER_CHAIR_DAY);
  });

  it('takes the SMALLER of the two guards, always', () => {
    const empty = adCapacity({ ...base, chairs: 2, bookedMinutes: 0, historyDays: 0 });
    const nearlyFull = adCapacity({ ...base, chairs: 2, bookedMinutes: WEEK * 2 * (60 / 7) * 0.9, historyDays: 60 });
    expect(empty.slots).toBe(2 * 14);           // the per-tech cap bites
    expect(nearlyFull.slots).toBeLessThan(2 * 14); // the free-time share bites
  });

  it('shrinks as the salon fills up', () => {
    const quiet = adCapacity({ ...base, bookedMinutes: 0, historyDays: 60 });
    const busy = adCapacity({ ...base, bookedMinutes: WEEK * 4 * (60 / 7) * 0.85, historyDays: 60 });
    expect(busy.utilisationPct).toBe(85);
    expect(busy.slots).toBeLessThan(quiet.slots!);
    expect(busy.slots).toBeGreaterThan(0); // busy is not full
  });
});

/**
 * The bug the file was written for, kept as a test: an almost-empty salon and
 * a booked-solid one used to produce the same 0.
 */
describe('an empty salon has room, a full one does not', () => {
  it('gives a brand-new salon a real number', () => {
    const c = adCapacity({ ...base, bookedMinutes: 0, historyDays: 3 });
    expect(c.slots).toBeGreaterThan(0);
    expect(c.utilisationPct).toBe(0);
    expect(c.basis).toBe('measured');
  });

  it('does not read a thin booking history as an empty diary OR a full one', () => {
    const thin = adCapacity({ ...base, bookedMinutes: 900, historyDays: 10 });
    const none = adCapacity({ ...base, bookedMinutes: 0, historyDays: 0 });
    expect(thin.slots).toBe(none.slots);
    expect(MIN_HISTORY_DAYS).toBe(14);
  });

  it('TELLS THE TWO ZEROS APART', () => {
    const empty = adCapacity({ ...base, bookedMinutes: 0, historyDays: 60 });
    const full = adCapacity({ ...base, bookedMinutes: WEEK * 4 * (60 / 7), historyDays: 60 });
    expect(empty.utilisationPct).toBe(0);
    expect(full.utilisationPct).toBe(100);
    expect(isFull(empty)).toBe(false);
    expect(isFull(full)).toBe(true);
    expect(full.slots).toBe(0);
  });
});

/**
 * "Rất nhiều khách họ không setup ghế."
 *
 * The staff list is the field salons skip most, and refusing to answer for all
 * of them is not a service. Their own booking book answers it: nine hours of
 * work booked on a nine-hour day means two people were working.
 */
describe('the salons that never set their staff up', () => {
  it('reads the chair count off the busiest day they have worked', () => {
    // Open 9h a day; 27 hours booked on one day means three people.
    const c = adCapacity({ ...base, chairs: null, openDaysPerWeek: 6, busiestDayMinutes: 27 * 60, bookedMinutes: 0, historyDays: 0 });
    expect(c.chairs).toBe(3);
    expect(c.chairsFrom).toBe('busiest-day');
    expect(c.slots).toBe(3 * 14);
  });

  it('never infers fewer than one', () => {
    const c = adCapacity({ ...base, chairs: null, openDaysPerWeek: 6, busiestDayMinutes: 20, bookedMinutes: 0, historyDays: 0 });
    expect(c.chairs).toBe(1);
  });

  it('prefers the staff list when there IS one', () => {
    const c = adCapacity({ ...base, chairs: 4, busiestDayMinutes: 27 * 60 });
    expect(c.chairs).toBe(4);
    expect(c.chairsFrom).toBe('staff');
  });

  it('says so plainly when there is neither a list nor a booking to measure', () => {
    const c = adCapacity({ ...base, chairs: null, busiestDayMinutes: 0 });
    expect(c.slots).toBeNull();
    expect(c.chairsFrom).toBe('none');
    expect(c.missing).toContain('chairs');
  });

  it('NEVER reports 0 slots from missing data', () => {
    for (const s of [{ ...base, chairs: null }, { ...base, chairs: 0 }, { ...base, chairs: undefined }]) {
      expect(adCapacity({ ...s, busiestDayMinutes: null }).slots).not.toBe(0);
    }
  });
});

describe('opening hours the salon never filled in', () => {
  it('falls back to a modest assumed week, and says so', () => {
    const c = adCapacity({ ...base, openMinutesPerWeek: null, bookedMinutes: 0, historyDays: 30 });
    expect(c.basis).toBe('assumed-hours');
    expect(c.missing).toEqual(['hours']);
  });

  it('assumes LOW, so a guess never makes a salon look emptier than it is', () => {
    expect(ASSUMED_OPEN_MINUTES_PER_WEEK).toBeLessThan(WEEK);
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
    expect(openMinutesPerWeek(split)).toBe(480);
  });

  it('says null for a salon that has not set any, rather than zero', () => {
    expect(openMinutesPerWeek(null)).toBeNull();
    expect(openMinutesPerWeek([])).toBeNull();
    expect(openMinutesPerWeek(Array(7).fill({ closed: true, openMinutes: 0, closeMinutes: 0 }))).toBeNull();
  });

  it('ignores a backwards window instead of going negative', () => {
    expect(openMinutesPerWeek([day(1200, 600), day(9 * 60, 17 * 60)])).toBe(8 * 60);
  });

  it('counts the days the shop actually opens', () => {
    const hours = [{ closed: true, openMinutes: 0, closeMinutes: 0 }, ...Array(6).fill(day(9 * 60, 18 * 60))];
    expect(openDaysPerWeek(hours)).toBe(6);
    expect(openDaysPerWeek(Array(7).fill({ closed: true, openMinutes: 0, closeMinutes: 0 }))).toBeNull();
    expect(openDaysPerWeek(null)).toBeNull();
  });
});

describe('the threshold that stops a genuinely full salon', () => {
  it('is a high bar, so a busy salon is not refused for being busy', () => {
    expect(FULL_PCT).toBeGreaterThanOrEqual(90);
    const busy = adCapacity({ ...base, bookedMinutes: WEEK * 4 * (60 / 7) * 0.8, historyDays: 60 });
    expect(isFull(busy)).toBe(false);
    expect(busy.slots).toBeGreaterThan(0);
  });
});
