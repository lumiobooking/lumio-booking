import { mayChangeBooking, rememberIds, visibleBookings } from './booking-privacy';

describe('a typed phone number is not proof on the anonymous website chat', () => {
  const rows = [{ id: 'mine' }, { id: 'someone-else' }];
  it('website chat: only bookings made in this conversation are seen or changed', () => {
    const here = new Set(['mine']);
    expect(visibleBookings('web', rows, here).map((r) => r.id)).toEqual(['mine']);
    expect(mayChangeBooking('web', 'someone-else', here)).toBe(false);
    expect(mayChangeBooking('web', 'mine', here)).toBe(true);
  });
  it('Facebook / Instagram / Zalo keep working as before', () => {
    for (const ch of ['messenger', 'instagram', 'zalo', undefined]) {
      expect(visibleBookings(ch, rows, new Set()).length).toBe(2);
      expect(mayChangeBooking(ch, 'someone-else', new Set())).toBe(true);
    }
  });
  it('remembers the newest bookings, without duplicates, capped', () => {
    expect(rememberIds({ ids: ['a', 'b'] }, ['b', 'c'], 3)).toEqual(['a', 'b', 'c']);
    expect(rememberIds(null, ['x'])).toEqual(['x']);
    expect(rememberIds({ ids: ['1', '2', '3'] }, ['4'], 3)).toEqual(['2', '3', '4']);
  });
});
