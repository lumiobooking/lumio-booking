import { readFileSync } from 'fs';
import { join } from 'path';
import { addMin, bandsFor, blockBody, blockedAt, blockLabel, type CalBlock } from './cal-blocks';

/**
 * Block tạm thời on the Calendar: what is painted where, what the sheet sends,
 * and that the screens are wired to it.
 */
const base = { name: '', reason: null, byOwner: true, startTime: null, endTime: null } as const;
const salon: CalBlock = { ...base, id: 's', staffId: null, wholeSalon: true, startDate: '2026-10-31', endDate: '2026-10-31', startTime: '13:00', endTime: '15:00', reason: 'Training' };
const kim: CalBlock = { ...base, id: 'k', staffId: 'kim', wholeSalon: false, name: 'Kim', startDate: '2026-10-30', endDate: '2026-11-01' };

describe('painting blocks', () => {
  it('a whole-salon block is in every column, the unassigned lane too', () => {
    expect(bandsFor([salon], 'lisa', '2026-10-31')).toEqual([{ s: 780, e: 900, b: salon }]);
    expect(bandsFor([salon], null, '2026-10-31')).toHaveLength(1);
  });
  it("a technician's block is only in her column, all day on each of its days", () => {
    expect(bandsFor([kim], 'kim', '2026-10-31')).toEqual([{ s: 0, e: 1440, b: kim }]);
    expect(bandsFor([kim], 'lisa', '2026-10-31')).toEqual([]);
    expect(bandsFor([kim], null, '2026-10-31')).toEqual([]);
    expect(bandsFor([kim], 'kim', '2026-11-02')).toEqual([]);
  });
  it('a click inside a block finds it; outside does not', () => {
    expect(blockedAt([salon], 'lisa', '2026-10-31', 13 * 60 + 30)).toBe(salon);
    expect(blockedAt([salon], 'lisa', '2026-10-31', 15 * 60)).toBeNull();
  });
  it('reads as a sentence', () => {
    expect(blockLabel(salon, true)).toBe('Cả tiệm khoá 13:00–15:00 · Training');
    expect(blockLabel(kim, true)).toBe('Kim nghỉ 30/10 → 1/11');
    expect(blockLabel({ ...kim, endDate: kim.startDate }, false)).toBe('Kim off all day');
  });
});

describe('what the sheet sends', () => {
  const f = { who: 'ALL', kind: 'hours' as const, date: '2026-10-31', endDate: '2026-10-31', from: '13:00', to: '15:00', reason: '  Training ' };
  it('a few hours for the whole salon: no staffId', () => {
    expect(blockBody(f)).toEqual({ ok: true, body: { startDate: '2026-10-31', endDate: '2026-10-31', startTime: '13:00', endTime: '15:00', reason: 'Training' } });
  });
  it('a technician, a day, several days', () => {
    expect(blockBody({ ...f, who: 'kim', kind: 'day', reason: '' })).toEqual({ ok: true, body: { staffId: 'kim', startDate: '2026-10-31', endDate: '2026-10-31' } });
    expect(blockBody({ ...f, kind: 'days', endDate: '2026-11-02', reason: '' })).toEqual({ ok: true, body: { startDate: '2026-10-31', endDate: '2026-11-02' } });
  });
  it('an end before the start is refused before it is sent', () => {
    expect(blockBody({ ...f, to: '12:00' })).toEqual({ ok: false, why: 'order' });
    expect(blockBody({ ...f, kind: 'days', endDate: '2026-10-30' })).toEqual({ ok: false, why: 'order' });
  });
  it('the hour chips stay on the same day', () => {
    expect(addMin('13:00', 120)).toBe('15:00');
    expect(addMin('23:00', 120)).toBe('23:59');
  });
});

describe('wired into the screens', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  it('the Calendar loads blocks, offers "Khoá giờ" and paints them in the columns', () => {
    const page = read('app', 'salon', 'calendar', 'page.tsx');
    expect(page).toMatch(/\/calendar-blocks\?from=/);
    expect(page).toMatch(/<BlockTimeSheet/);
    const day = read('app', 'salon', 'calendar', 'StaffDayView.tsx');
    expect(day).toMatch(/bandsFor\(blocks, un \? null : c\.id, dayKey\)/);
    expect(day).toMatch(/if \(inBlock\(m\)\)/);
  });
  it('the booking page never offers a slot inside a whole-salon block', () => {
    expect(read('app', 'book', '[slug]', 'page.tsx')).toMatch(/avail\.salonBusy\.length && overlapsTz\(s, avail\.salonBusy/);
  });
});
