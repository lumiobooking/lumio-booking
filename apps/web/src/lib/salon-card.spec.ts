import { initialsOf, isInAppBrowser, mapsHref, mapsTarget, minutesInZone, nextOpening, openStatus, prettyPhone, smsShareHref, telHref } from './salon-card';

describe('salon card facts', () => {
  const day = { openMinutes: 600, closeMinutes: 1200 }; // 10:00 – 20:00

  it('is open inside the hours and says until when', () => {
    expect(openStatus({ day, nowMinutes: 15 * 60, mode: 'hours' })).toEqual({ kind: 'open', until: 1200 });
  });

  it('before opening says when it opens; after closing says closed now', () => {
    expect(openStatus({ day, nowMinutes: 9 * 60 })).toEqual({ kind: 'later', at: 600, until: 1200 });
    expect(openStatus({ day, nowMinutes: 20 * 60 })).toEqual({ kind: 'closedNow' });
  });

  it('split shifts: the lunch gap reads as opening later, not closed', () => {
    const split = { intervals: [{ open: 540, close: 720 }, { open: 780, close: 1140 }] };
    expect(openStatus({ day: split, nowMinutes: 750 })).toEqual({ kind: 'later', at: 780, until: 1140 });
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

  it('after closing, points to the next day the shop opens (skipping closed days and days off)', () => {
    const open = { openMinutes: 540, closeMinutes: 1170 };
    const week = [{ closed: true }, open, open, open, open, open, { closed: true }]; // Sun + Sat closed
    const fri = new Date(2026, 9, 16); // Friday
    expect(nextOpening({ week, today: fri })).toMatchObject({ inDays: 3, at: 540 }); // Monday
    const wed = new Date(2026, 9, 14);
    expect(nextOpening({ week, today: wed })).toMatchObject({ inDays: 1, at: 540 });
    expect(nextOpening({ week, today: wed, daysOff: ['2026-10-15'] })).toMatchObject({ inDays: 2 });
    expect(nextOpening({ week: Array(7).fill({ closed: true }), today: wed })).toBeNull();
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

describe('the three buttons work wherever the page is opened', () => {
  it('recognises the in-app browsers our visitors arrive in', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 musical_ly_2023')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isInAppBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36')).toBe(false);
    expect(isInAppBrowser(null)).toBe(false);
  });
  it('Directions: a new tab from an embed, the same tab in an in-app browser', () => {
    expect(mapsTarget({ framed: true, inApp: true })).toBe('_blank');
    expect(mapsTarget({ framed: false, inApp: true })).toBe('_self');
    expect(mapsTarget({ framed: false, inApp: false })).toBe('_blank');
  });
  it('a text message carries the name and the link', () => {
    expect(smsShareHref('An Sen', 'https://lumiobooking.com/ansen')).toBe(`sms:?&body=${encodeURIComponent('An Sen — https://lumiobooking.com/ansen')}`);
  });
  it('the number is shown the way people read it', () => {
    expect(prettyPhone('4035550123')).toBe('(403) 555-0123');
    expect(prettyPhone('+1 403-555-0123')).toBe('(403) 555-0123');
    expect(prettyPhone('+84 90 123 4567')).toBe('+84 90 123 4567');
  });
});
