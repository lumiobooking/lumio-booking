import {
  addDaysToKey, dayKeyTz, dayRangeTz, hourTz, monthKeyTz, monthRangeTz,
  startOfDayTz, tzPartsOf, wallTimeToUtcTz, weekdayTz,
} from './salon-time';

// One instant, two truths: the evening of 1 Sep in Austin is already 2 Sep in
// UTC and in Vietnam. Every assertion below is that the salon's truth wins.
const AUSTIN_EVENING = new Date('2026-09-02T01:30:00Z'); // Tue 8:30pm in Austin
const TZ = 'America/Chicago';

describe('whose day an instant belongs to', () => {
  it('files an Austin evening under the Austin day, not the UTC one', () => {
    expect(dayKeyTz(AUSTIN_EVENING, TZ)).toBe('2026-09-01');
    expect(monthKeyTz(AUSTIN_EVENING, TZ)).toBe('2026-09');
    expect(hourTz(AUSTIN_EVENING, TZ)).toBe(20);
    expect(weekdayTz(AUSTIN_EVENING, TZ)).toBe(2); // Tuesday
  });

  it('falls back to UTC on a timezone Intl rejects, instead of crashing a report', () => {
    expect(dayKeyTz(AUSTIN_EVENING, 'Not/AZone')).toBe('2026-09-02');
  });
});

describe('a salon day as instants', () => {
  it('anchors midnight to the salon, DST-correct for that date', () => {
    // CDT (UTC-5) in September; CST (UTC-6) in January.
    expect(startOfDayTz('2026-09-01', TZ).toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(startOfDayTz('2026-01-15', TZ).toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });

  it('wall time means the salon wall', () => {
    expect(wallTimeToUtcTz('2026-07-30', '16:00', TZ).toISOString()).toBe('2026-07-30T21:00:00.000Z');
  });
});

describe('calendar arithmetic no timezone can bend', () => {
  it('walks day keys across month and year ends', () => {
    expect(addDaysToKey('2026-09-01', 1)).toBe('2026-09-02');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('report windows', () => {
  it('covers the requested salon days inclusively — the last afternoon stays in', () => {
    const r = dayRangeTz('2026-09-01', '2026-09-30', TZ);
    expect(r.from.toISOString()).toBe('2026-09-01T05:00:00.000Z');
    // 30 Sep 23:59:59.999 in Austin = 1 Oct 04:59:59.999Z
    expect(r.to.toISOString()).toBe('2026-10-01T04:59:59.999Z');
    expect(r.fromKey).toBe('2026-09-01');
    expect(r.toKey).toBe('2026-09-30');
  });

  it('defaults to the trailing window ending on the SALON today', () => {
    const r = dayRangeTz(null, null, TZ, { now: AUSTIN_EVENING, defaultDays: 30 });
    expect(r.toKey).toBe('2026-09-01'); // still 1 Sep at the salon
    expect(r.fromKey).toBe('2026-08-03');
  });

  it('a month range knows its own edges in the salon zone', () => {
    const m = monthRangeTz(AUSTIN_EVENING, TZ);
    expect(m.key).toBe('2026-09');
    expect(m.from.toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(monthRangeTz(AUSTIN_EVENING, TZ, -1).key).toBe('2026-08');
  });
});

describe('tzPartsOf', () => {
  it('reads hour 24 as 0, the way some ICU builds print midnight', () => {
    const p = tzPartsOf(new Date('2026-09-01T05:00:00Z'), TZ);
    expect(p.h).toBe(0);
    expect(p.d).toBe(1);
  });
});
