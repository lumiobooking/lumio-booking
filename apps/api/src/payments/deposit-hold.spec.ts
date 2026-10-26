import { amountCovers, DEFAULT_HOLD_MINUTES, holdExpired, holdMinutesOf } from './deposit-hold';

describe('deposit hold', () => {
  const t0 = new Date('2026-10-26T10:00:00Z');
  it('runs out after the salon\'s minutes, never when set to 0', () => {
    expect(holdExpired(t0, 30, new Date('2026-10-26T10:29:00Z'))).toBe(false);
    expect(holdExpired(t0, 30, new Date('2026-10-26T10:30:00Z'))).toBe(true);
    expect(holdExpired(t0, 0, new Date('2026-10-27T10:00:00Z'))).toBe(false);
  });
  it('only the offered choices; anything else is the default', () => {
    expect(holdMinutesOf({ holdMinutes: 15 })).toBe(15);
    expect(holdMinutesOf({ holdMinutes: 0 })).toBe(0);
    expect(holdMinutesOf({ holdMinutes: 7 })).toBe(DEFAULT_HOLD_MINUTES);
    expect(holdMinutesOf(null)).toBe(DEFAULT_HOLD_MINUTES);
  });
  it('paid at least what was due', () => {
    expect(amountCovers(1000, 1000)).toBe(true);
    expect(amountCovers(999, 1000)).toBe(true);
    expect(amountCovers(500, 1000)).toBe(false);
    expect(amountCovers(undefined, 1000)).toBe(true);
  });
});
