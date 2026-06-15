import { addMinutes, rangesOverlap } from './booking.util';

describe('addMinutes', () => {
  it('adds minutes correctly', () => {
    const base = new Date('2026-06-15T09:00:00.000Z');
    expect(addMinutes(base, 45).toISOString()).toBe('2026-06-15T09:45:00.000Z');
  });
});

describe('rangesOverlap', () => {
  const at = (h: number, m = 0) => new Date(2026, 5, 15, h, m);

  it('detects a clear overlap', () => {
    expect(rangesOverlap(at(9), at(10), at(9, 30), at(10, 30))).toBe(true);
  });

  it('detects full containment', () => {
    expect(rangesOverlap(at(9), at(12), at(10), at(11))).toBe(true);
  });

  it('treats back-to-back bookings as non-overlapping', () => {
    // 09:00–10:00 and 10:00–11:00 must be allowed.
    expect(rangesOverlap(at(9), at(10), at(10), at(11))).toBe(false);
  });

  it('treats fully separate ranges as non-overlapping', () => {
    expect(rangesOverlap(at(9), at(10), at(14), at(15))).toBe(false);
  });

  it('is symmetric', () => {
    expect(rangesOverlap(at(9, 30), at(10, 30), at(9), at(10))).toBe(true);
  });
});
