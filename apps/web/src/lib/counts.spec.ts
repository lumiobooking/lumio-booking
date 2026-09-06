import { compactCount, ageOf } from './counts';

describe('numbers the way a phone says them', () => {
  it('Vietnamese: comma decimal, K / Tr / Tỷ', () => {
    expect(compactCount(950, true)).toBe('950');
    expect(compactCount(1234, true)).toBe('1,2K');
    expect(compactCount(45_600, true)).toBe('46K');
    expect(compactCount(1_234_567, true)).toBe('1,2Tr');
    expect(compactCount(2_100_000_000, true)).toBe('2,1Tỷ');
  });
  it('English: point decimal, K / M / B', () => {
    expect(compactCount(1234, false)).toBe('1.2K');
    expect(compactCount(1_234_567, false)).toBe('1.2M');
    expect(compactCount(-5, false)).toBe('0');
  });
  it('age is a feel, not a log', () => {
    const now = Date.parse('2026-09-06T12:00:00Z');
    expect(ageOf('2026-09-06T01:00:00Z', true, now)).toBe('hôm nay');
    expect(ageOf('2026-09-05T01:00:00Z', false, now)).toBe('yesterday');
    expect(ageOf('2026-09-03T01:00:00Z', true, now)).toBe('3 ngày trước');
    expect(ageOf('2026-08-20T01:00:00Z', false, now)).toBe('2 weeks ago');
    expect(ageOf('2026-06-01T01:00:00Z', true, now)).toBe('3 tháng trước');
    expect(ageOf('nope', true, now)).toBe('');
  });
});
