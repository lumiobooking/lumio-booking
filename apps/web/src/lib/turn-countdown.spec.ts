import { countdown } from './turn-countdown';

describe('turn countdown', () => {
  const now = Date.parse('2026-11-19T07:00:00Z');
  it('words the time left and colours the last minutes', () => {
    expect(countdown('2026-11-19T07:00:42Z', now)).toEqual({ text: 'còn 0:42', tone: 'bad' });
    expect(countdown('2026-11-19T07:02:30Z', now)).toEqual({ text: 'còn 2:30', tone: 'warn' });
    expect(countdown('2026-11-19T07:08:20Z', now)).toEqual({ text: 'còn 8:20', tone: 'info' });
    expect(countdown('2026-11-19T08:05:00Z', now)?.text).toBe('còn 1g05');
  });
  it('past due says it is passing on; nothing set says nothing', () => {
    expect(countdown('2026-11-19T06:59:00Z', now)?.text).toBe('đang chuyển…');
    expect(countdown(null, now)).toBeNull();
    expect(countdown('nope', now)).toBeNull();
  });
});
