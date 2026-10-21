import { canStepForward, comparePeriod, customPeriod, periodFor, rangeText, shiftPeriod, weekStart, addMonths } from './period';

// Wednesday, October 21, 2026.
const today = '2026-10-21';

describe('named periods, in the salon’s days', () => {
  it('weeks start on Monday, months and years on the 1st', () => {
    expect(weekStart(today)).toBe('2026-10-19');
    expect(periodFor('thisWeek', today)).toMatchObject({ from: '2026-10-19', to: today, unit: 'week' });
    expect(periodFor('lastWeek', today)).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(periodFor('thisMonth', today)).toMatchObject({ from: '2026-10-01', to: today, unit: 'month' });
    expect(periodFor('lastMonth', today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodFor('last30', today)).toMatchObject({ from: '2026-09-22', to: today });
    expect(periodFor('lastYear', today)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodFor('lastMonth', '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('a hand-picked whole month or day is recognised', () => {
    expect(customPeriod('2026-09-01', '2026-09-30', today)).toMatchObject({ kind: 'lastMonth', unit: 'month' });
    expect(customPeriod('2026-08-01', '2026-08-31', today)).toMatchObject({ kind: 'custom', unit: 'month' });
    expect(customPeriod('2026-10-05', '2026-10-05', today)).toMatchObject({ kind: 'custom', unit: 'day' });
    expect(customPeriod('2026-10-10', '2026-10-03', today)).toMatchObject({ from: '2026-10-03', to: '2026-10-10', unit: 'span' });
  });
});

describe('‹ › step by whole periods, never past today', () => {
  it('a month so far steps back to the whole month before, and forward again', () => {
    const sep = shiftPeriod(periodFor('thisMonth', today), -1, today);
    expect(sep).toMatchObject({ from: '2026-09-01', to: '2026-09-30', kind: 'lastMonth' });
    expect(shiftPeriod(sep, 1, today)).toMatchObject({ from: '2026-10-01', to: today, kind: 'thisMonth' });
    expect(canStepForward(periodFor('thisMonth', today), today)).toBe(false);
  });
  it('days, weeks and spans', () => {
    expect(shiftPeriod(periodFor('today', today), -1, today)).toMatchObject({ kind: 'yesterday' });
    expect(shiftPeriod(periodFor('thisWeek', today), -1, today)).toMatchObject({ kind: 'lastWeek' });
    expect(shiftPeriod(periodFor('last30', today), -1, today)).toMatchObject({ from: '2026-08-23', to: '2026-09-21' });
    expect(shiftPeriod(periodFor('today', today), 1, today)).toMatchObject({ kind: 'today' }); // nothing after today
  });
});

describe('like-for-like comparison', () => {
  it('a month so far against the same days of last month; a week so far against the same weekdays', () => {
    expect(comparePeriod(periodFor('thisMonth', today), 'previous')).toEqual({ from: '2026-09-01', to: '2026-09-21' });
    expect(comparePeriod(periodFor('thisWeek', today), 'previous')).toEqual({ from: '2026-10-12', to: '2026-10-14' });
    expect(comparePeriod(periodFor('today', today), 'previous')).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(comparePeriod(periodFor('last30', today), 'previous')).toEqual({ from: '2026-08-23', to: '2026-09-21' });
    expect(comparePeriod(periodFor('thisMonth', today), 'lastYear')).toEqual({ from: '2025-10-01', to: '2025-10-21' });
    expect(comparePeriod(periodFor('today', today), 'none')).toBeNull();
  });
  it('a month whose day is past the end of the month before is clamped', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(comparePeriod(customPeriod('2026-03-01', '2026-03-31', '2026-04-10'), 'previous')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('reads like a US screen', () => {
  it('month, single day and ranges', () => {
    expect(rangeText('2026-09-01', '2026-09-30', 'en-US')).toBe('September 2026');
    expect(rangeText('2026-10-20', '2026-10-20', 'en-US')).toBe('Tue, Oct 20, 2026');
    expect(rangeText('2026-10-01', '2026-10-21', 'en-US')).toBe('Oct 1 – Oct 21, 2026');
    expect(rangeText('2025-12-29', '2026-01-04', 'en-US')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});
