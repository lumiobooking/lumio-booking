import { missedMinutes, MISSED_AFTER_MIN } from './missed';

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

describe('a booking nobody came to', () => {
  it('reads "not arrived" an hour past its start, not before', () => {
    expect(missedMinutes({ status: 'CONFIRMED', startTime: at(59) })).toBeNull();
    expect(missedMinutes({ status: 'CONFIRMED', startTime: at(MISSED_AFTER_MIN) })).toBe(60);
    expect(missedMinutes({ status: 'PENDING', startTime: at(130) })).toBe(130);
  });
  it('never for a customer who arrived, finished, cancelled or was marked already', () => {
    for (const status of ['ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'REJECTED']) {
      expect(missedMinutes({ status, startTime: at(300) })).toBeNull();
    }
  });
  it('a future booking is simply upcoming', () => {
    expect(missedMinutes({ status: 'CONFIRMED', startTime: at(-30) })).toBeNull();
  });
});
