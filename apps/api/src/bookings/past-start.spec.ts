import { DESK_PAST_GRACE_MS, pastStartProblem } from './past-start';

describe('how far back a booking may start', () => {
  const now = Date.parse('2026-10-15T23:40:00Z'); // 4:40 PM in Vancouver
  const ago = (min: number) => new Date(now - min * 60_000);

  it('the desk may record a customer who is already in the chair', () => {
    expect(pastStartProblem(ago(70), now, true)).toBeNull(); // came in at 3:30
    expect(pastStartProblem(new Date(now - DESK_PAST_GRACE_MS + 60_000), now, true)).toBeNull();
  });

  it('but not a time more than 12 hours gone (wrong day, AM/PM slip)', () => {
    expect(pastStartProblem(ago(13 * 60), now, true)).toMatch(/^startTime is in the past/);
  });

  it('online, chat and hotline bookings stay in the future (2 minutes of slack)', () => {
    expect(pastStartProblem(ago(1), now, false)).toBeNull();
    expect(pastStartProblem(ago(10), now, false)).toBe('startTime is in the past');
    expect(pastStartProblem(new Date(now + 3600_000), now, false)).toBeNull();
  });
});
