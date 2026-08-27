import { todayInZone, weekdayInZone, sameCalendarDay } from './salon-clock';

/** 2026-08-27 16:00 UTC. In Los Angeles it is 09:00 on the 27th; in Ho Chi
 *  Minh City it is 23:00 on the 27th; in Auckland it is already the 28th. */
const INSTANT = new Date('2026-08-27T16:00:00.000Z');

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('the salon decides what day it is, not the visitor', () => {
  it.each([
    ['America/Los_Angeles', '2026-08-27'],
    ['America/New_York', '2026-08-27'],
    ['Asia/Ho_Chi_Minh', '2026-08-27'],
    ['Pacific/Auckland', '2026-08-28'],
    ['UTC', '2026-08-27'],
  ])('%s → %s', (tz, expected) => {
    expect(ymd(todayInZone(tz, INSTANT))).toBe(expected);
  });

  // The bug in one assertion: at this instant a Vietnamese salon and a New
  // Zealand salon are on different dates, so they must not read the same row of
  // business hours.
  it('puts two salons on different dates when they really are', () => {
    expect(ymd(todayInZone('Asia/Ho_Chi_Minh', INSTANT)))
      .not.toBe(ymd(todayInZone('Pacific/Auckland', INSTANT)));
  });

  // Just before midnight in Vietnam, a visitor anywhere must still be told the
  // salon's date — this is the boundary the old code got wrong every night.
  it('holds across the salon midnight boundary', () => {
    const justBefore = new Date('2026-08-27T16:59:00.000Z'); // 23:59 in Vietnam
    const justAfter = new Date('2026-08-27T17:01:00.000Z'); // 00:01 next day
    expect(ymd(todayInZone('Asia/Ho_Chi_Minh', justBefore))).toBe('2026-08-27');
    expect(ymd(todayInZone('Asia/Ho_Chi_Minh', justAfter))).toBe('2026-08-28');
  });

  it('returns midnight, so the date can be used as a day cursor', () => {
    const d = todayInZone('Asia/Ho_Chi_Minh', INSTANT);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });
});

describe('the weekday used to look up business hours', () => {
  // 2026-08-27 is a Thursday; 2026-08-28 a Friday.
  it('reads Thursday for Vietnam and Friday for Auckland at the same instant', () => {
    expect(weekdayInZone('Asia/Ho_Chi_Minh', INSTANT)).toBe(4);
    expect(weekdayInZone('Pacific/Auckland', INSTANT)).toBe(5);
  });

  // The costly version of this bug: reading Sunday's row on a Saturday, where
  // Sunday is marked closed, tells a customer the salon is shut when it is open.
  it('does not roll a Saturday salon into Sunday for a reader who is ahead', () => {
    const satEvening = new Date('2026-08-29T22:00:00.000Z'); // Sat 15:00 in LA
    expect(weekdayInZone('America/Los_Angeles', satEvening)).toBe(6); // Saturday
    expect(weekdayInZone('Asia/Ho_Chi_Minh', satEvening)).toBe(0); // already Sunday there
  });
});

describe('a salon with no timezone keeps the behaviour it has today', () => {
  // Not every tenant row has one, and a missing value must not blank the badge
  // or crash the page. Falling back to the visitor's date is exactly what the
  // page did before this file existed.
  it.each([null, undefined, '', '   '])('falls back for %s', (tz) => {
    const fallback = todayInZone(tz, INSTANT);
    const viewer = new Date(INSTANT.getTime());
    viewer.setHours(0, 0, 0, 0);
    expect(ymd(fallback)).toBe(ymd(viewer));
  });

  it('falls back rather than throwing on a nonsense timezone', () => {
    expect(() => todayInZone('Mars/Olympus_Mons', INSTANT)).not.toThrow();
    const d = todayInZone('Mars/Olympus_Mons', INSTANT);
    expect(d.getHours()).toBe(0);
  });
});

describe('sameCalendarDay — whether the word "today" is honest', () => {
  it('is true for the same date', () => {
    expect(sameCalendarDay(new Date(2026, 7, 27), new Date(2026, 7, 27, 23, 59))).toBe(true);
  });

  it('is false across a date boundary', () => {
    expect(sameCalendarDay(new Date(2026, 7, 27), new Date(2026, 7, 28))).toBe(false);
  });

  it('is false across a year boundary that shares a day number', () => {
    expect(sameCalendarDay(new Date(2026, 7, 27), new Date(2027, 7, 27))).toBe(false);
  });
});
