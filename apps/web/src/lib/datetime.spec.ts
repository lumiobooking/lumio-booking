import { dayKeyInTz, hourInTz, instantToWall, presetRangeInTz, wallToInstantISO } from './datetime';

// The dashboard is read from anywhere; the salon is in one place. These tests
// pass the timezone explicitly — in the app it comes from localStorage, and
// with none stored every helper falls back to the browser's old behaviour.
const TZ = 'America/Chicago';

describe('what the owner types is the salon wall clock', () => {
  it('turns a datetime-local string into the salon instant, DST-correct', () => {
    expect(wallToInstantISO('2026-09-02T20:59', TZ)).toBe('2026-09-03T01:59:00.000Z'); // CDT
    expect(wallToInstantISO('2026-01-15T20:59', TZ)).toBe('2026-01-16T02:59:00.000Z'); // CST
  });

  it('round-trips through the picker without moving the appointment', () => {
    const iso = wallToInstantISO('2026-09-02T14:00', TZ);
    expect(instantToWall(iso, TZ)).toBe('2026-09-02T14:00');
  });
});

describe('whose day a stored instant belongs to', () => {
  it('keeps an Austin evening on the Austin day', () => {
    // Tue 8:30pm in Austin is already Wednesday in UTC and in Vietnam.
    expect(dayKeyInTz('2026-09-02T01:30:00Z', TZ)).toBe('2026-09-01');
    expect(hourInTz('2026-09-02T01:30:00Z', TZ)).toBe(20);
  });
});

describe('report presets', () => {
  it('builds ranges from wall digits, never through UTC', () => {
    // Freeze "now" indirectly: just check the shape and internal consistency.
    const m = presetRangeInTz('thisMonth', TZ);
    expect(m.from.endsWith('-01')).toBe(true);
    expect(m.to >= m.from).toBe(true);
    const lm = presetRangeInTz('lastMonth', TZ);
    expect(lm.to < m.from).toBe(true);
    expect(lm.from.endsWith('-01')).toBe(true);
  });
});
