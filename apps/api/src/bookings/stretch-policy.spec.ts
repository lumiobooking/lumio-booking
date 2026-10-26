import { clashMessage, stretchMayOverlap } from './stretch-policy';

const NOW = new Date('2026-10-25T23:00:00Z');
const clash = { staff: 'Letys', customer: 'Renu Rai', start: new Date('2026-10-25T16:15:00Z'), end: new Date('2026-10-25T18:15:00Z') };

describe('stretching a visit over the next booking', () => {
  it('a visit that started or finished records the time it really took', () => {
    expect(stretchMayOverlap('COMPLETED', new Date('2026-10-26T15:00:00Z'), NOW)).toBe(true);
    expect(stretchMayOverlap('ARRIVED', new Date('2026-10-26T15:00:00Z'), NOW)).toBe(true);
    expect(stretchMayOverlap('CONFIRMED', new Date('2026-10-25T15:00:00Z'), NOW)).toBe(true);
  });
  it('a visit still ahead may not sit on another booking', () => {
    expect(stretchMayOverlap('CONFIRMED', new Date('2026-10-26T15:00:00Z'), NOW)).toBe(false);
    expect(stretchMayOverlap('PENDING', new Date('2026-10-26T15:00:00Z'), NOW)).toBe(false);
  });
  it('the refusal names the booking, its time in the salon clock and what to do', () => {
    const m = clashMessage(clash, new Date('2026-10-25T16:30:00Z'), 'America/Chicago', 'en', 'blocked');
    expect(m).toMatch(/Letys is already booked with Renu Rai at 11:15\s?AM–1:15\s?PM/);
    expect(m).toMatch(/11:30\s?AM/);
    expect(m).toMatch(/another technician or move it first/);
    const vi = clashMessage(clash, new Date('2026-10-25T16:30:00Z'), 'America/Chicago', 'vi', 'warning');
    expect(vi).toMatch(/^Đã lưu\. Lưu ý: Letys cũng có lịch Renu Rai/);
  });
});
