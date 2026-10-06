import { readFileSync } from 'fs';
import { join } from 'path';
import { arrivalState, clockIn, minutesText, salonDayLabel } from './desk-time';
import { deskHoursCheck, hoursMessage, wallLabel, wallParts } from './desk-hours';

/**
 * The front desk from the screenshots: 10:00 AM bookings shown as "0:00", an
 * 11:40 PM booking as "13:40", the header a day ahead, a 23:40 booking taken
 * on a salon that closes at 6, the receptionist locked out of booking, and a
 * customer in a chair listed as "ready to pay" while her technician showed free.
 */
const LA = 'America/Los_Angeles';
// Monday 5 Oct 2026, 10:00 AM in Los Angeles (UTC-7) = 17:00Z = 00:00 Tuesday in Vietnam.
const TEN_AM_LA = '2026-10-05T17:00:00.000Z';
const ELEVEN_40_PM_LA = '2026-10-06T06:40:00.000Z';

describe('clocks are the salon’s, whoever is looking', () => {
  it('10:00 AM in Los Angeles reads 10:00, not 0:00', () => {
    expect(clockIn(TEN_AM_LA, LA, true)).toBe('10:00');
    expect(clockIn(TEN_AM_LA, LA, false)).toBe('10:00 AM');
    expect(clockIn(ELEVEN_40_PM_LA, LA, true)).toBe('23:40');
  });
  it('the header is the salon’s day (Monday), not the viewer’s (Tuesday in Vietnam)', () => {
    expect(salonDayLabel(Date.parse('2026-10-06T06:00:00Z'), LA, false)).toMatch(/Monday/);
    expect(salonDayLabel(Date.parse('2026-10-06T06:00:00Z'), LA, true).toLowerCase()).toMatch(/thứ hai/);
  });
  it('nothing to show for a missing time', () => {
    expect(clockIn(null, LA, true)).toBe('');
  });
});

describe('who is about to arrive, who is late', () => {
  const now = Date.parse(TEN_AM_LA);
  it('splits the day into due now / soon / later / late', () => {
    expect(arrivalState(TEN_AM_LA, now)).toEqual({ kind: 'now', minutes: 0 });
    expect(arrivalState(new Date(now + 20 * 60000), now)).toEqual({ kind: 'soon', minutes: 20 });
    expect(arrivalState(new Date(now + 90 * 60000), now)).toEqual({ kind: 'later', minutes: 90 });
    expect(arrivalState(new Date(now - 130 * 60000), now)).toEqual({ kind: 'late', minutes: 130 });
  });
  it('writes minutes the way the desk reads them', () => {
    expect(minutesText(25, true)).toBe('25′');
    expect(minutesText(130, true)).toBe('2g 10′');
    expect(minutesText(120, false)).toBe('2h');
  });
});

describe('the desk may only book while the salon is open', () => {
  const hours = { businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60 }), daysOff: ['2026-11-26'] };
  it('11:40 PM is refused with a sentence that says "evening"', () => {
    const c = deskHoursCheck('2026-10-05T23:40', hours, true);
    expect(c.ok).toBe(false);
    expect(hoursMessage('2026-10-05T23:40', c, true)).toBe('Thứ Hai 5/10 lúc 23:40 (tối) nằm ngoài giờ làm việc (9:00–18:00). Kiểm tra lại SA/CH (sáng/chiều) hoặc chọn giờ khác.');
    expect(hoursMessage('2026-10-05T23:40', deskHoursCheck('2026-10-05T23:40', hours, false), false)).toMatch(/11:40 PM is outside opening hours \(9:00 AM–6:00 PM\)/);
  });
  it('11:40 AM and 5:30 PM pass; 6:00 PM does not', () => {
    expect(deskHoursCheck('2026-10-05T11:40', hours, true).ok).toBe(true);
    expect(deskHoursCheck('2026-10-05T17:30', hours, true).ok).toBe(true);
    expect(deskHoursCheck('2026-10-05T18:00', hours, true).ok).toBe(false);
  });
  it('a day off and a closed weekday are refused', () => {
    expect(deskHoursCheck('2026-11-26T11:00', hours, true)).toEqual({ ok: false, reason: 'dayOff', open: '' });
    const sundayOff = { businessHours: hours.businessHours.map((d, i) => (i === 0 ? { ...d, closed: true } : d)) };
    expect(deskHoursCheck('2026-10-04T11:00', sundayOff, true)).toEqual({ ok: false, reason: 'closed', open: '' });
  });
  it('no hours on file: nothing to check against, never a block', () => {
    expect(deskHoursCheck('2026-10-05T23:40', null, true).ok).toBe(true);
  });
  it('reads the picked time back in words, salon wall clock (no timezone maths)', () => {
    expect(wallParts('2026-10-05T23:40')).toMatchObject({ weekday: 1, minutes: 23 * 60 + 40 });
    expect(wallLabel('2026-10-06T11:40', true)).toBe('Thứ Ba 6/10 lúc 11:40 (sáng)');
    expect(wallLabel('2026-10-06T11:40', false)).toBe('Tuesday 10/6 at 11:40 AM');
  });
});

describe('wired into the screens', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  it('the booking page no longer fails whole for a receptionist (payments are owner-only)', () => {
    const src = read('app', 'salon', 'bookings', 'page.tsx');
    expect(src).toMatch(/apiFetch<Payment\[\]>\('\/payments', \{ token \}\)\.catch\(/);
    expect(src).toMatch(/deskHoursCheck\(form\.startLocal/);
    expect(src).toMatch(/wallToInstantISO\(form\.startLocal, salonTz \|\| undefined\)/);
    expect(src).toMatch(/autoAssign: chosenStaff \? undefined : autoPick/);
  });
  it('the front desk reads every clock in the salon’s timezone', () => {
    const src = read('app', 'salon', 'front-desk', 'page.tsx');
    expect(src).toMatch(/board\?\.timezone/);
    expect(src).toMatch(/clockIn\(iso, tz, vi\)/);
    expect(src).not.toMatch(/toLocaleTimeString\(/);
  });
  it('the walk-ins page shows "waiting to pay" apart from the chairs', () => {
    const src = read('app', 'salon', 'walkins', 'page.tsx');
    expect(src).toMatch(/filter\(\(w\) => !w\.awaitingPayment && w\.phase !== 'BETWEEN'\)/);
    expect(src).toMatch(/const toPay = board\.serving\.filter\(\(w\) => w\.awaitingPayment\)/);
  });
});
