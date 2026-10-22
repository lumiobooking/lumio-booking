import { cancelLine, clock, hoursRows, priceLabel, uses12h } from './static-menu';

describe('the booking page a crawler reads', () => {
  it('writes real hours, Monday first, with split shifts and closed days', () => {
    const rows = hoursRows([
      { day: 0, closed: true, open: '00:00', close: '00:00' },
      { day: 1, closed: false, open: '09:30', close: '19:00' },
      { day: 2, closed: false, open: '09:30', close: '19:00', intervals: [{ open: '09:30', close: '13:00' }, { open: '14:00', close: '19:00' }] },
    ], true);
    expect(rows).toEqual([
      { day: 'Monday', text: '9:30 AM – 7:00 PM' },
      { day: 'Tuesday', text: '9:30 AM – 1:00 PM, 2:00 PM – 7:00 PM' },
      { day: 'Sunday', text: 'Closed' },
    ]);
  });

  it('uses a 24-hour clock for đồng salons only', () => {
    expect(uses12h('USD')).toBe(true);
    expect(uses12h('CAD')).toBe(true);
    expect(uses12h('VND')).toBe(false);
    expect(clock('00:15', true)).toBe('12:15 AM');
    expect(clock('12:00', true)).toBe('12:00 PM');
    expect(clock('19:05', false)).toBe('19:05');
  });

  it('never prints a bare $0', () => {
    expect(priceLabel(0, false, 'USD')).toBe('Free');
    expect(priceLabel(0, true, 'USD')).toBe('Price set at the salon');
    expect(priceLabel(4900, false, 'USD')).toBe('$49');
    expect(priceLabel(4500, true, 'USD')).toBe('from $45');
    expect(priceLabel(250000, false, 'VND')).toContain('250,000');
  });

  it('states the salon’s own cancellation rule', () => {
    expect(cancelLine({ selfCancel: true, cancelNoticeHours: 24 }, '+1 210')).toContain('up to 24 hours before');
    expect(cancelLine({ selfCancel: true, cancelNoticeHours: 1 }, null)).toContain('up to 1 hour before');
    expect(cancelLine({ selfCancel: false, cancelNoticeHours: null }, '+1 210-971-7070')).toBe('To cancel or reschedule, call the salon at +1 210-971-7070.');
    expect(cancelLine(null, null)).toBe('To cancel or reschedule, contact the salon.');
  });
});
