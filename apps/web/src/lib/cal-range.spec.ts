import { readFileSync } from 'fs';
import { join } from 'path';
import { minToHm, offSpans, partsWithOpen, rangeChoices, rangeResultText, snapRange } from './cal-range';

/**
 * "Cho phép giữ chuột kéo khung giờ thợ off … khung giờ nào off thì ẩn luôn
 * đặt lịch … giữ chuột kéo và cho mở lịch lại … trên tất cả thiết bị"
 * (2 Nov 2026).
 */
const kimParts = [{ s: 600, e: 1080 }]; // 10:00–18:00
const MON = '2026-11-09';

describe('what the column shows', () => {
  it('extra hours opened for the day are part of her shift; other days and other techs are not', () => {
    const open = [{ id: 'o1', staffId: 'kim', day: MON, startTime: '18:00', endTime: '20:00' }, { id: 'o2', staffId: 'lily', day: MON, startTime: '08:00', endTime: '10:00' }];
    expect(partsWithOpen(kimParts, open, 'kim', MON)).toEqual([{ s: 600, e: 1200 }]);
    expect(partsWithOpen(kimParts, open, 'kim', '2026-11-10')).toEqual(kimParts);
  });

  it('off = outside her hours; a day off is off all day; no hours on file is never off', () => {
    expect(offSpans(true, kimParts, 540, 1260)).toEqual([{ s: 540, e: 600 }, { s: 1080, e: 1260 }]);
    expect(offSpans(true, [], 540, 1260)).toEqual([{ s: 540, e: 1260 }]);
    expect(offSpans(false, [], 540, 1260)).toEqual([]);
  });

  it('a drag snaps to quarter hours, either direction, at least 15 minutes', () => {
    expect(snapRange(13 * 60 + 7, 15 * 60 + 2)).toEqual({ s: 780, e: 915 });
    expect(snapRange(15 * 60 + 2, 13 * 60 + 7)).toEqual({ s: 780, e: 915 });
    expect(snapRange(600, 600)).toEqual({ s: 600, e: 615 });
    expect(minToHm(1440)).toBe('24:00');
  });
});

describe('what a drag offers', () => {
  const desk = { byOwner: true, wholeSalon: false };
  it('over free working time: block it, or book it', () => {
    expect(rangeChoices({ s: 720, e: 780 }, { off: [{ s: 1080, e: 1440 }], blocks: [], busy: [] })).toMatchObject({ close: true, open: false, book: true });
  });
  it('over off time: open it again — not book it', () => {
    expect(rangeChoices({ s: 1080, e: 1200 }, { off: [{ s: 1080, e: 1440 }], blocks: [] })).toMatchObject({ close: false, open: true, book: false });
  });
  it('over a block the desk made: open it; over a booking: no "book" here', () => {
    expect(rangeChoices({ s: 720, e: 780 }, { off: [], blocks: [{ s: 700, e: 800, b: desk }] })).toMatchObject({ close: false, open: true });
    expect(rangeChoices({ s: 720, e: 780 }, { off: [], blocks: [], busy: [{ s: 750, e: 800 }] })).toMatchObject({ close: true, book: false });
  });
  it('leave the technician asked for or a whole-salon block is not opened from a column', () => {
    const c = rangeChoices({ s: 720, e: 780 }, { off: [], blocks: [{ s: 0, e: 1440, b: { byOwner: false, wholeSalon: false } }, { s: 700, e: 800, b: { byOwner: true, wholeSalon: true } }] });
    expect(c).toMatchObject({ open: false, close: false, leaveInside: true, salonInside: true });
  });
  it('says what happened, and what was left alone', () => {
    expect(rangeResultText({ action: 'close', name: 'Kim', range: { s: 960, e: 1080 }, blocked: 1, bookingsInside: 2 }, true)).toBe('Đã khoá 16:00–18:00 của Kim. Có 2 lịch hẹn trong giờ này — nhớ dời lịch.');
    expect(rangeResultText({ action: 'open', name: 'Kim', range: { s: 1080, e: 1200 }, extraHours: 1, leaveKept: true }, true)).toMatch(/^Đã mở lịch 18:00–20:00 cho Kim\. Ngày nghỉ phép/);
  });
});

describe('wired into the Calendar on every device', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  const day = read('app', 'salon', 'calendar', 'StaffDayView.tsx');
  it('desktop column: drag binds, off time offers no booking, a click there says how to open it', () => {
    expect(day).toMatch(/rangeDrag\.bind\(c\.id, minAt, gStart, endH \* 60\)/);
    expect(day).toMatch(/inBlock\(m\) \|\| inOff\(m\)\) \{ if \(g\) setGhost\(null\)/);
    expect(day).toMatch(/if \(inOff\(m\)\) \{ flash\(offHint/);
  });
  it('phone: both the all-technicians grid and one technician bind the same drag, and paint blocks', () => {
    expect(day.match(/rangeDrag\.bind\(r\.id,/g)).toHaveLength(2);
    expect(day.match(/bandsFor\(blocks, r\.id, dayKeyTop\)/g)).toHaveLength(2);
    expect(day.match(/\{rangeUi\}/g)).toHaveLength(3);
  });
  it('the drag works by touch (hold, then drag; the page does not scroll under the finger)', () => {
    const drag = read('app', 'salon', 'calendar', 'RangeDrag.tsx');
    expect(drag).toMatch(/HOLD_MS = 420/);
    expect(drag).toMatch(/addEventListener\('touchmove', stop, \{ passive: false \}\)/);
    expect(drag).toMatch(/setPointerCapture/);
  });
  it('the page reads the extra hours with the blocks and re-reads after a drag', () => {
    const page = read('app', 'salon', 'calendar', 'page.tsx');
    expect(page).toMatch(/setOpenHours\(r\?\.open \?\? \[\]\)/);
    expect(page).toMatch(/openHours=\{openHours\} onBlocksChanged=/);
  });
});
