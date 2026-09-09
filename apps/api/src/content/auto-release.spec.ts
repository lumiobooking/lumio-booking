import { dueForRelease, localHourIn, RELEASE_HOUR } from './auto-release';

describe('dueForRelease', () => {
  const day = '2026-09-09';

  it('waits for the salon morning on the day itself', () => {
    expect(dueForRelease({ forDate: day, localDay: day, localHour: RELEASE_HOUR - 1 })).toBe(false);
    expect(dueForRelease({ forDate: day, localDay: day, localHour: RELEASE_HOUR })).toBe(true);
    expect(dueForRelease({ forDate: day, localDay: day, localHour: 23 })).toBe(true);
  });

  it('never releases tomorrow early, always releases a day that has passed', () => {
    expect(dueForRelease({ forDate: '2026-09-10', localDay: day, localHour: 23 })).toBe(false);
    expect(dueForRelease({ forDate: '2026-09-08', localDay: day, localHour: 0 })).toBe(true);
  });

  it('respects a salon a person is holding', () => {
    expect(dueForRelease({ forDate: day, localDay: day, localHour: 12, mode: 'manual' })).toBe(false);
    expect(dueForRelease({ forDate: day, localDay: day, localHour: 12, mode: 'auto' })).toBe(true);
    expect(dueForRelease({ forDate: day, localDay: day, localHour: 12, mode: null })).toBe(true);
  });

  it('refuses malformed dates rather than guessing', () => {
    expect(dueForRelease({ forDate: 'today', localDay: day, localHour: 12 })).toBe(false);
  });
});

describe('localHourIn', () => {
  it('reads the wall clock of the zone, including midnight as 0', () => {
    const t = new Date('2026-09-09T07:30:00Z');
    expect(localHourIn('UTC', t)).toBe(7);
    expect(localHourIn('Asia/Ho_Chi_Minh', t)).toBe(14);
    expect(localHourIn('America/Chicago', t)).toBe(2);
    expect(localHourIn('UTC', new Date('2026-09-09T00:10:00Z'))).toBe(0);
  });
  it('falls back to UTC on a zone it does not know', () => {
    const t = new Date('2026-09-09T07:30:00Z');
    expect(localHourIn('Mars/Olympus', t)).toBe(7);
  });
});
