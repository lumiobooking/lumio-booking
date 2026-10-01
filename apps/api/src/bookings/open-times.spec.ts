import { openTimesFor } from './open-times';

const DAY = { closed: false, openMinutes: 9 * 60, closeMinutes: 17 * 60 };
const at = (hm: string) => new Date(`2026-10-02T${hm}:00.000Z`); // tz UTC below, so wall == instant
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

describe('the till\'s list of open times', () => {
  it('offers every step from opening, and never a start the visit cannot finish before closing', () => {
    const t = openTimesFor({ dateStr: '2026-10-02', tz: 'UTC', day: DAY, stepMinutes: 30, durationMinutes: 60, busy: [], now: at('00:00') });
    expect(hhmm(t[0])).toBe('09:00');
    expect(hhmm(t[t.length - 1])).toBe('16:00'); // 16:30 + 60 min would run past 17:00
    expect(t).toHaveLength(15);
  });

  it('skips the tech\'s existing bookings, including a partial overlap', () => {
    const busy = [{ start: at('10:00'), end: at('10:45') }];
    const t = openTimesFor({ dateStr: '2026-10-02', tz: 'UTC', day: DAY, stepMinutes: 30, durationMinutes: 60, busy, now: at('00:00') }).map(hhmm);
    expect(t).not.toContain('09:30'); // 09:30–10:30 overlaps 10:00
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('10:30'); // 10:30–11:30 overlaps the 10:45 tail
    expect(t).toContain('11:00');
    expect(t).toContain('09:00');     // 09:00–10:00 ends exactly as the booking starts: fine
  });

  it('offers nothing in the past, nothing on a day off, nothing when the day is closed', () => {
    expect(openTimesFor({ dateStr: '2026-10-02', tz: 'UTC', day: DAY, stepMinutes: 30, durationMinutes: 30, busy: [], now: at('16:10') }).map(hhmm)).toEqual(['16:30']);
    expect(openTimesFor({ dateStr: '2026-10-02', tz: 'UTC', day: DAY, closedToday: true, stepMinutes: 30, durationMinutes: 30, busy: [], now: at('00:00') })).toEqual([]);
    expect(openTimesFor({ dateStr: '2026-10-02', tz: 'UTC', day: { ...DAY, closed: true }, stepMinutes: 30, durationMinutes: 30, busy: [], now: at('00:00') })).toEqual([]);
  });

  it('respects split shifts and the salon\'s own timezone', () => {
    const split = { closed: false, openMinutes: 600, closeMinutes: 1200, intervals: [{ open: 600, close: 780 }, { open: 960, close: 1200 }] };
    const t = openTimesFor({ dateStr: '2026-10-02', tz: 'America/Chicago', day: split, stepMinutes: 60, durationMinutes: 60, busy: [], now: new Date('2026-10-01T00:00:00Z') });
    // 10:00 Chicago (CDT, UTC-5) is 15:00Z; the lunch gap 13:00–16:00 offers nothing.
    expect(t[0].toISOString()).toBe('2026-10-02T15:00:00.000Z');
    const wall = t.map((d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(d));
    expect(wall).toEqual(['10:00', '11:00', '12:00', '16:00', '17:00', '18:00', '19:00']);
  });
});
