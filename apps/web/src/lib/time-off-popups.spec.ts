import { readFileSync } from 'fs';
import { join } from 'path';
import { addDaysKey, dateTile, kindOf, phaseOf, spanSentence } from './time-off-ui';

/**
 * The Staff page's time off, redesigned: cards with a date tile, and every
 * change (record, edit, approve, decline, remove) in a pop-up that says what
 * was applied.
 */
describe('what the cards say', () => {
  it('the date tile', () => {
    expect(dateTile('2026-10-31', true)).toEqual({ dow: 'T7', day: '31', month: 'Th10' });
    expect(dateTile('2026-10-31', false)).toEqual({ dow: 'Sat', day: '31', month: 'Oct' });
  });
  it('the sentence: hours, a day, several days', () => {
    expect(spanSentence({ startDate: '2026-10-31', endDate: '2026-10-31', startTime: '13:00', endTime: '16:00' }, true)).toBe('Thứ Bảy 31/10 · 13:00–16:00');
    expect(spanSentence({ startDate: '2026-10-31', endDate: '2026-10-31', startTime: null, endTime: null }, true)).toBe('Thứ Bảy 31/10 · cả ngày');
    expect(spanSentence({ startDate: '2026-10-31', endDate: '2026-11-02', startTime: null, endTime: null }, true)).toBe('Thứ Bảy 31/10 → Thứ Hai 2/11 (3 ngày)');
  });
  it('off now / coming / past, and the form kind of a stored row', () => {
    const r = { startDate: '2026-10-30', endDate: '2026-11-01', startTime: null, endTime: null };
    expect(phaseOf(r, '2026-10-31')).toBe('now');
    expect(phaseOf(r, '2026-10-29')).toBe('later');
    expect(phaseOf(r, '2026-11-02')).toBe('past');
    expect(kindOf(r)).toBe('days');
    expect(kindOf({ ...r, endDate: r.startDate })).toBe('day');
    expect(kindOf({ ...r, endDate: r.startDate, startTime: '09:00', endTime: '12:00' })).toBe('hours');
    expect(addDaysKey('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('every change is a pop-up', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  const panel = read('app', 'salon', 'staff', 'TimeOffPanel.tsx');
  const dialog = read('app', 'salon', 'staff', 'TimeOffDialog.tsx');
  it('record, edit, approve/decline and remove open dialogs — no inline form, no delete without asking', () => {
    expect(panel).toMatch(/<TimeOffDialog /);
    expect(panel).toMatch(/<DecideDialog /);
    expect(panel).toMatch(/<ConfirmDialog /);
    expect(panel).not.toMatch(/setAdd\(/);
    expect(panel).not.toMatch(/onClick=\{\(\) => remove\(/);
  });
  it('an edit is a PATCH of that row (/edit); saving shows what was applied and the bookings inside', () => {
    expect(dialog).toMatch(/method: editing \? 'PATCH' : 'POST'/);
    expect(dialog).toMatch(/\/edit` : '\/time-off'/);
    expect(dialog).toMatch(/bookingsInside/);
    expect(dialog).toMatch(/\/salon\/calendar\?day=\$\{day\}/);
  });
  it('the Calendar opens the day it is sent to', () => {
    expect(read('app', 'salon', 'calendar', 'page.tsx')).toMatch(/get\('day'\)/);
  });
});
