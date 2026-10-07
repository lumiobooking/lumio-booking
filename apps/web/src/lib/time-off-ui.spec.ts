/** Nghỉ phép on the owner's side: labels, day counts, and the desk's reason when everyone is on leave. */
import { daysOf, leaveReason, whenLabel } from './time-off-ui';

describe('time-off labels', () => {
  it('whole days, a range, a part of a day', () => {
    expect(daysOf({ startDate: '2026-10-10', endDate: '2026-10-10', startTime: null, endTime: null })).toBe(1);
    expect(daysOf({ startDate: '2026-10-10', endDate: '2026-10-12', startTime: null, endTime: null })).toBe(3);
    expect(daysOf({ startDate: '2026-10-10', endDate: '2026-10-10', startTime: '13:00', endTime: '17:00' })).toBe(0.5);
    expect(whenLabel({ startDate: '2026-10-10', endDate: '2026-10-10', startTime: '13:00', endTime: '17:00' }, false)).toContain('13:00–17:00');
    expect(whenLabel({ startDate: '2026-10-10', endDate: '2026-10-12', startTime: null, endTime: null }, false)).toContain('→');
  });
  it('the desk is told when the technicians who could do it are on leave — and only then', () => {
    expect(leaveReason(0, 2, true)).toContain('nghỉ phép');
    expect(leaveReason(0, 0, true)).toBeNull();
    expect(leaveReason(1, 2, true)).toBeNull();
  });
});
