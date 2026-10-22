import { bufferOf, padSpan } from './buffer';

describe('time between appointments', () => {
  it('reads the salon rule safely', () => {
    expect(bufferOf({ bufferMinutes: 15 })).toBe(15);
    expect(bufferOf({ bufferMinutes: 999 })).toBe(60);
    expect(bufferOf({ bufferMinutes: -5 })).toBe(0);
    expect(bufferOf({})).toBe(0);
    expect(bufferOf(null)).toBe(0);
    expect(bufferOf({ bufferMinutes: 'x' })).toBe(0);
  });
  it('pads a booking on both sides, so the next one cannot start in the gap', () => {
    const s = { start: new Date('2026-10-25T15:00:00Z'), end: new Date('2026-10-25T16:00:00Z'), id: 'a' };
    const p = padSpan(s, 15);
    expect(p.start.toISOString()).toBe('2026-10-25T14:45:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-25T16:15:00.000Z');
    expect(p.id).toBe('a');
    expect(padSpan(s, 0)).toBe(s);
  });
});
