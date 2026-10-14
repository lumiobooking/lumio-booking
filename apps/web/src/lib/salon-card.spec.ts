import { initialsOf, mapsHref, minutesInZone, openStatus, telHref } from './salon-card';

describe('salon card facts', () => {
  const day = { openMinutes: 600, closeMinutes: 1200 }; // 10:00 – 20:00

  it('is open inside the hours and says until when', () => {
    expect(openStatus({ day, nowMinutes: 15 * 60, mode: 'hours' })).toEqual({ kind: 'open', until: 1200 });
  });

  it('before opening says when it opens; after closing says closed now', () => {
    expect(openStatus({ day, nowMinutes: 9 * 60 })).toEqual({ kind: 'later', at: 600 });
    expect(openStatus({ day, nowMinutes: 20 * 60 })).toEqual({ kind: 'closedNow' });
  });

  it('split shifts: the lunch gap reads as opening later, not closed', () => {
    const split = { intervals: [{ open: 540, close: 720 }, { open: 780, close: 1140 }] };
    expect(openStatus({ day: split, nowMinutes: 750 })).toEqual({ kind: 'later', at: 780 });
    expect(openStatus({ day: split, nowMinutes: 800 })).toEqual({ kind: 'open', until: 1140 });
  });

  it('a day off or a closed day is closed today', () => {
    expect(openStatus({ day, isDayOff: true, nowMinutes: 700 })).toEqual({ kind: 'closedToday' });
    expect(openStatus({ day: { closed: true }, nowMinutes: 700 })).toEqual({ kind: 'closedToday' });
    expect(openStatus({ day: null, nowMinutes: 700 })).toEqual({ kind: 'closedToday' });
  });

  it('respects an owner who switched the opening line off', () => {
    expect(openStatus({ day, nowMinutes: 700, mode: 'off' })).toBeNull();
  });

  it('reads the salon clock, not the visitor clock', () => {
    const instant = new Date('2026-10-14T18:30:00Z');
    expect(minutesInZone('America/Edmonton', instant)).toBe(12 * 60 + 30);
    expect(minutesInZone('Asia/Ho_Chi_Minh', instant)).toBe(1 * 60 + 30);
  });

  it('builds call and map links from what the owner typed', () => {
    expect(telHref('+1 (403) 991-5868')).toBe('tel:+14039915868');
    expect(telHref('0903 123 456')).toBe('tel:0903123456');
    expect(telHref('')).toBe('');
    expect(mapsHref('An Sen', '2705 Centre St NW')).toBe('https://www.google.com/maps/search/?api=1&query=An%20Sen%2C%202705%20Centre%20St%20NW');
    expect(mapsHref('An Sen', '  ')).toBe('');
  });

  it('initials skip symbols and keep Vietnamese letters', () => {
    expect(initialsOf('An Sen Massage & Wellness')).toBe('AS');
    expect(initialsOf('Ánh Dương Nails')).toBe('ÁD');
    expect(initialsOf('')).toBe('');
  });
});
