import { dueToday } from './feed-schedule';

describe('daily Google feed survives deploys (16/11/2026)', () => {
  const at = (iso: string) => new Date(iso);
  it('not before the hour', () => { expect(dueToday(at('2026-11-17T02:59:00Z'), 3, null)).toBe(false); });
  it('any time after the hour when nothing ran today — a restart at 03:13 still runs it at 03:20 or 09:00', () => {
    expect(dueToday(at('2026-11-17T03:20:00Z'), 3, null)).toBe(true);
    expect(dueToday(at('2026-11-17T09:00:00Z'), 3, { at: '2026-11-16T03:10:00Z', uploaded: true })).toBe(true);
  });
  it('once a day: an upload today, or nothing ready today, ends it', () => {
    expect(dueToday(at('2026-11-17T05:00:00Z'), 3, { at: '2026-11-17T03:10:00Z', uploaded: true })).toBe(false);
    expect(dueToday(at('2026-11-17T05:00:00Z'), 3, { at: '2026-11-17T03:10:00Z', uploaded: false, error: 'no salon ready' })).toBe(false);
  });
  it('a failed try is retried, at most hourly', () => {
    expect(dueToday(at('2026-11-17T03:40:00Z'), 3, { at: '2026-11-17T03:10:00Z', uploaded: false, error: 'timeout' })).toBe(false);
    expect(dueToday(at('2026-11-17T04:11:00Z'), 3, { at: '2026-11-17T03:10:00Z', uploaded: false, error: 'timeout' })).toBe(true);
  });
});
