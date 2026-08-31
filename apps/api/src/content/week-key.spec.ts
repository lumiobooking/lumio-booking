import { weekKey, weekStart, isoWeek, isPastWeek, weekLabel, localParts } from './week-key';

const AUSTIN = 'America/Chicago';
const HANOI = 'Asia/Ho_Chi_Minh';

describe('the week belongs to the salon’s clock, not the server’s', () => {
  it('files a Sunday evening in Texas under the week it is there', () => {
    // 21:00 Sunday in Austin is already Monday 02:00 UTC. Keying off UTC would
    // file the plan the owner is reading tonight under NEXT week.
    const sundayNight = new Date('2026-09-07T02:00:00Z');
    expect(localParts(sundayNight, AUSTIN)).toEqual({ y: 2026, m: 9, d: 6 });
    expect(weekKey(sundayNight, AUSTIN)).toBe(weekKey(new Date('2026-09-04T15:00:00Z'), AUSTIN));
  });

  it('puts two salons in different weeks at the same instant, correctly', () => {
    // Monday 04:00 in Hanoi is still Sunday in Austin — a real 14-hour gap.
    const t = new Date('2026-09-06T21:00:00Z');
    expect(weekKey(t, HANOI)).not.toBe(weekKey(t, AUSTIN));
  });

  it('falls back to UTC rather than throwing on a bad timezone', () => {
    expect(weekKey(new Date('2026-09-02T12:00:00Z'), 'Not/AZone')).toBe('2026-W36');
  });
});

describe('ISO weeks at the turn of the year', () => {
  it('gives 1 January 2027 to week 53 of 2026, where it belongs', () => {
    // ISO weeks belong to the year of their THURSDAY. A naive getFullYear()
    // files this under "2027-W53" — a week that does not exist — right next to
    // the real one, so the archive quietly grows a twin.
    expect(isoWeek(2027, 1, 1)).toEqual({ year: 2026, week: 53 });
  });

  it('gives 31 December 2024 to week 1 of 2025', () => {
    expect(isoWeek(2024, 12, 31)).toEqual({ year: 2025, week: 1 });
  });

  it('starts 2026 at week 1', () => {
    expect(isoWeek(2026, 1, 1).week).toBe(1);
    expect(isoWeek(2026, 1, 1).year).toBe(2026);
  });

  it('never produces week 0 or week 54', () => {
    for (let m = 1; m <= 12; m += 1) {
      for (const d of [1, 15, 28]) {
        const { week } = isoWeek(2026, m, d);
        expect(week).toBeGreaterThanOrEqual(1);
        expect(week).toBeLessThanOrEqual(53);
      }
    }
  });
});

describe('Sunday is the end of the week, not the start of the next one', () => {
  it('keeps Sunday with the six days before it', () => {
    // JS numbers Sunday 0, ISO numbers it 7. Getting that wrong moves every
    // Sunday forward a week — the exact day an owner sits down to read the plan.
    const mon = new Date('2026-08-31T12:00:00Z');
    const sun = new Date('2026-09-06T12:00:00Z');
    expect(weekKey(sun, 'UTC')).toBe(weekKey(mon, 'UTC'));
    expect(weekKey(new Date('2026-09-07T12:00:00Z'), 'UTC')).not.toBe(weekKey(mon, 'UTC'));
  });

  it('starts the week on Monday', () => {
    expect(weekStart(new Date('2026-09-06T12:00:00Z'), 'UTC')).toBe('2026-08-31');
    expect(weekStart(new Date('2026-08-31T12:00:00Z'), 'UTC')).toBe('2026-08-31');
  });
});

describe('a past week is frozen', () => {
  const now = new Date('2026-09-02T12:00:00Z'); // 2026-W36

  it('knows which weeks are behind it', () => {
    expect(isPastWeek('2026-W35', now, 'UTC')).toBe(true);
    expect(isPastWeek('2026-W36', now, 'UTC')).toBe(false);
    expect(isPastWeek('2026-W37', now, 'UTC')).toBe(false);
  });

  it('sorts correctly as plain strings, which is why the key is padded', () => {
    // '2026-W9' would sort after '2026-W36'. The padding is the whole reason
    // the archive can be ordered without parsing anything.
    expect(['2026-W36', '2026-W09', '2026-W10'].sort()).toEqual(['2026-W09', '2026-W10', '2026-W36']);
  });
});

describe('the label is for a person', () => {
  it('reads as a week and a year', () => {
    expect(weekLabel('2026-W36')).toBe('Tuần 36, 2026');
  });

  it('passes anything it does not recognise straight through', () => {
    expect(weekLabel('nonsense')).toBe('nonsense');
  });
});
