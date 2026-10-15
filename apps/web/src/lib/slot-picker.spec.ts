import { dayOptions, firstOpenDay, slotsForDay, wallOf } from './slot-picker';

const week = Array.from({ length: 7 }, (_, d) => (d === 0 ? { closed: true } : { openMinutes: 600, closeMinutes: 1080 }));
const rules = { businessHours: week, daysOff: ['2026-10-20'] };
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

describe('booking time picker', () => {
  it('offers only open days, marking Sundays and days off', () => {
    const days = dayOptions('2026-10-15', rules, 7);
    expect(days.map((d) => `${d.d}${d.open ? '' : `:${d.reason}`}`)).toEqual(['15', '16', '17', '18:closed', '19', '20:dayOff', '21']);
  });

  it('only times inside opening hours, never one already gone', () => {
    const s = slotsForDay('2026-10-16', rules, { nowWall: '2026-10-15T08:31' });
    expect(hhmm(s[0].min)).toBe('10:00');
    expect(hhmm(s[s.length - 1].min)).toBe('17:45');
    expect(s).toHaveLength(32);
    const today = slotsForDay('2026-10-15', rules, { nowWall: '2026-10-15T14:05' });
    expect(hhmm(today[0].min)).toBe('14:15');
    expect(slotsForDay('2026-10-18', rules, { nowWall: '2026-10-15T08:00' })).toEqual([]);
    expect(slotsForDay('2026-10-20', rules, { nowWall: '2026-10-15T08:00' })).toEqual([]);
  });

  it('the desk can bring back today\'s earlier times for a customer already here', () => {
    const s = slotsForDay('2026-10-15', rules, { nowWall: '2026-10-15T14:05', showPast: true });
    expect(hhmm(s[0].min)).toBe('10:00');
    expect(s.filter((x) => x.past).length).toBe(17); // 10:00 … 14:00
  });

  it('a split day keeps its lunch break out', () => {
    const split = { businessHours: Array.from({ length: 7 }, () => ({ intervals: [{ open: 540, close: 720 }, { open: 780, close: 840 }] })) };
    expect(slotsForDay('2026-10-16', split, { nowWall: '2026-10-15T08:00' }).map((x) => hhmm(x.min))).toEqual(
      ['9:00', '9:15', '9:30', '9:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '13:00', '13:15', '13:30', '13:45']);
  });

  it('after closing, the first day with a time left is tomorrow', () => {
    expect(firstOpenDay('2026-10-15', rules, '2026-10-15T18:10')).toBe('2026-10-16');
    expect(firstOpenDay('2026-10-17', rules, '2026-10-17T19:00')).toBe('2026-10-19'); // Sunday shut
    expect(wallOf('2026-10-16', 570)).toBe('2026-10-16T09:30');
  });
});
