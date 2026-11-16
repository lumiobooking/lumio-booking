import { staffBusyMessage } from './busy-message';

describe('staffBusyMessage', () => {
  const start = new Date('2026-11-16T15:00:00Z'); // 10:00 in New York
  const end = new Date('2026-11-16T15:30:00Z');
  it('names the tech and the clashing visit in the salon clock', () => {
    expect(staffBusyMessage({ staffName: 'Amy', start, end, tz: 'America/New_York' }))
      .toBe('STAFF_BUSY: Amy already has a client on 2026-11-16 10:00-10:30. Change the time first, or pick another technician.');
  });
  it('mentions the rest gap when the salon keeps one', () => {
    expect(staffBusyMessage({ staffName: 'Amy', start, end, tz: 'America/New_York', bufferMin: 10 })).toMatch(/keeps 10 minutes between/);
  });
  it('never carries a client name and survives a bad zone', () => {
    const m = staffBusyMessage({ staffName: null, start, end, tz: 'Not/AZone' });
    expect(m).toMatch(/^STAFF_BUSY: This technician already has a client on 2026-11-16 15:00-15:30\./);
  });
});
