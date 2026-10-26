import {
  activeFilterCount, applyFilters, attentionOf, capacityMinutes, facetCounts, isClosedDay, listKey, loadLevel, loadOf,
  monthGrid, nextMonday, NO_FILTERS, periodOf, stripDays, suggestStart, summarize, toggle, type DayBooking,
  cardLines, statusTag, cardInk,
} from './cal-day';

const NOW = new Date('2026-10-14T13:45:00').getTime();
const at = (hm: string, mins = 45) => {
  const s = new Date(`2026-10-14T${hm}:00`);
  return { startTime: s.toISOString(), endTime: new Date(s.getTime() + mins * 60000).toISOString() };
};
const bk = (id: string, hm: string, status: string, extra: Partial<DayBooking> = {}): DayBooking => ({
  id, status, priceCents: 5000, assignedStaff: { id: 'alan' }, ...at(hm), ...extra,
});

const DAY: DayBooking[] = [
  bk('done', '09:30', 'COMPLETED', { source: 'gmap' }),
  bk('ns', '11:30', 'NO_SHOW', { assignedStaff: null }),
  bk('chair', '13:00', 'ARRIVED', { source: 'hotline' }),
  bk('late', '13:30', 'CONFIRMED', { source: 'instagram' }),
  bk('pend', '14:00', 'PENDING', { assignedStaff: null }),
  bk('conf', '15:00', 'CONFIRMED'),
  bk('unas', '16:00', 'CONFIRMED', { assignedStaff: null, source: 'gmap' }),
  bk('gone', '18:00', 'CANCELLED'),
];

describe('calendar day model', () => {
  it('names every state, with "not arrived" 10 minutes after the start', () => {
    expect(DAY.map((b) => listKey(b, NOW))).toEqual(['completed', 'noshow', 'arrived', 'late', 'pending', 'confirmed', 'confirmed', 'cancelled']);
    expect(listKey(bk('x', '13:40', 'CONFIRMED'), NOW)).toBe('confirmed'); // 5 min in
  });

  it('what needs someone: late first, then to-confirm, then no technician', () => {
    expect(DAY.map((b) => attentionOf(b, NOW))).toEqual([null, null, null, 'late', 'pending', null, 'unassigned', null]);
  });

  it('sums the day: no-shows count as appointments but not as money; cancelled is neither', () => {
    const s = summarize(DAY, NOW);
    expect(s.appointments).toBe(7);
    expect(s.expectedCents).toBe(6 * 5000);
    expect(s.doneCents).toBe(5000);
    expect([s.checkedIn, s.noShow, s.cancelled]).toEqual([1, 1, 1]);
    expect(s.attention).toEqual({ late: 1, pending: 1, unassigned: 1, total: 3 });
  });

  it('filters: OR inside a group, AND across groups, and presets', () => {
    expect(applyFilters(DAY, NO_FILTERS, NOW)).toBe(DAY);
    const f = { ...NO_FILTERS, sources: ['gmap' as const] };
    expect(applyFilters(DAY, f, NOW).map((b) => b.id)).toEqual(['done', 'unas']);
    expect(applyFilters(DAY, { ...f, staff: ['__un'] }, NOW).map((b) => b.id)).toEqual(['unas']);
    expect(applyFilters(DAY, { ...NO_FILTERS, preset: 'attention' }, NOW).map((b) => b.id)).toEqual(['late', 'pend', 'unas']);
    expect(applyFilters(DAY, { ...NO_FILTERS, preset: 'unassigned' }, NOW).map((b) => b.id)).toEqual(['pend', 'unas']);
    expect(applyFilters(DAY, { ...NO_FILTERS, preset: 'online' }, NOW).map((b) => b.id)).not.toContain('chair');
    expect(applyFilters(DAY, { ...NO_FILTERS, preset: 'upcoming' }, NOW).map((b) => b.id)).toEqual(['pend', 'conf', 'unas']);
    expect(applyFilters(DAY, { ...NO_FILTERS, statuses: ['late', 'pending'] }, NOW).map((b) => b.id)).toEqual(['late', 'pend']);
    expect(activeFilterCount({ ...f, preset: 'online' })).toBe(2);
  });

  it('counts each option against the OTHER groups, so a count never promises an empty list', () => {
    const f = { ...NO_FILTERS, sources: ['gmap' as const] };
    const c = facetCounts(DAY, f, NOW);
    expect(c.sources.gmap).toBe(2); // its own group is ignored
    expect(c.sources.instagram).toBe(1);
    expect(c.staff).toEqual({ alan: 1, __un: 1 });
    for (const [k, n] of Object.entries(c.staff)) {
      expect(applyFilters(DAY, { ...f, staff: [k] }, NOW)).toHaveLength(n);
    }
  });

  it('can leave cancelled bookings out of every count but their own', () => {
    const c = facetCounts(DAY, NO_FILTERS, NOW, { hideCancelled: true });
    expect(c.statuses.cancelled).toBe(1);
    expect(Object.values(c.staff).reduce((a, b) => a + b, 0)).toBe(DAY.length - 1);
    expect(facetCounts(DAY, NO_FILTERS, NOW).staff.alan).toBe(c.staff.alan + 1);
  });

  it('periods, strips and grids', () => {
    expect([periodOf(9 * 60), periodOf(12 * 60), periodOf(17 * 60)]).toEqual([0, 1, 2]);
    const s = stripDays(new Date(2026, 9, 14), 14);
    expect(s[0].getDay()).toBe(1);
    expect(s[0].getDate()).toBe(12);
    expect(s).toHaveLength(14);
    expect(stripDays(new Date(2026, 9, 18), 7)[0].getDate()).toBe(12); // Sunday belongs to the week before
    const g = monthGrid(new Date(2026, 9, 1));
    expect(g.slice(0, 4)).toEqual([null, null, null, new Date(2026, 9, 1)]);
    expect(nextMonday(new Date(2026, 9, 12)).getDate()).toBe(19);
    expect(nextMonday(new Date(2026, 9, 14)).getDate()).toBe(19);
    expect(toggle(['a'], 'a')).toEqual([]);
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('how full a day is: shifts, fallback to opening hours, closed days', () => {
    const week = Array.from({ length: 7 }, (_, d) => (d === 0 ? { closed: true } : { openMinutes: 540, closeMinutes: 1140 }));
    const wed = new Date(2026, 9, 14);
    const staff = [
      { id: 'a', workingHours: [{ dayOfWeek: 3, startTime: '10:00', endTime: '19:00', isActive: true }] },
      { id: 'b' }, // no hours set → opening hours (600 min)
      { id: 'c', takesAppointments: false },
    ];
    expect(capacityMinutes({ date: wed, staff, week })).toBe(540 + 600);
    expect(capacityMinutes({ date: new Date(2026, 9, 18), staff, week })).toBe(0); // Sunday closed
    expect(isClosedDay({ date: wed, week, daysOff: ['2026-10-14'] })).toBe(true);
    expect(isClosedDay({ date: wed, week: null })).toBe(false);
    expect(capacityMinutes({ date: wed, staff: [], week })).toBe(600);
    expect(loadOf(570, 1140)).toBe(0.5);
    expect(loadOf(10, 0)).toBeNull();
    expect([loadLevel(0.5), loadLevel(0.7), loadLevel(0.95)]).toEqual(['light', 'busy', 'full']);
  });

  it('"Đặt lịch" opens on a time the salon is open', () => {
    const week = Array.from({ length: 7 }, (_, d) => (d === 0 ? { closed: true } : { openMinutes: 600, closeMinutes: 1080 }));
    const wed = new Date(2026, 9, 14);
    const at = (r: { date: Date; minutes: number }) => `${r.date.getDate()} ${Math.floor(r.minutes / 60)}:${String(r.minutes % 60).padStart(2, '0')}`;
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 4 * 60 + 20, week }))).toBe('14 10:00'); // 4:20 AM → opening
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 13 * 60 + 45, week }))).toBe('14 14:00');
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 18 * 60 + 5, week }))).toBe('15 10:00'); // closed → tomorrow
    const sat = new Date(2026, 9, 17);
    expect(at(suggestStart({ date: sat, today: sat, nowMin: 19 * 60, week }))).toBe('19 10:00'); // Sunday closed → Monday
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 9 * 60, week, daysOff: ['2026-10-14'] }))).toBe('15 10:00');
    expect(at(suggestStart({ date: new Date(2026, 9, 20), today: wed, nowMin: 15 * 60, week }))).toBe('20 10:00');
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 4 * 60 + 20, week: null }))).toBe('14 4:30'); // no hours: as before
    const split = Array.from({ length: 7 }, () => ({ intervals: [{ open: 540, close: 720 }, { open: 780, close: 1140 }] }));
    expect(at(suggestStart({ date: wed, today: wed, nowMin: 12 * 60 + 10, week: split }))).toBe('14 13:00'); // lunch break
  });
});

describe('phone technician card: never more lines than room', () => {
  // 84px an hour, card = duration minus 4px of gutter.
  const h = (min: number) => (min / 60) * 84 - 4;
  it('30 min is one line, 45 min two, 60 min and up three', () => {
    expect(cardLines(h(30))).toBe(1);
    expect(cardLines(h(45))).toBe(2);
    expect(cardLines(h(60))).toBe(3);
    expect(cardLines(h(90))).toBe(3);
  });
  it('labels the status next to the name, in the salon language', () => {
    expect(statusTag('COMPLETED', false)).toBe('Done');
    expect(statusTag('COMPLETED', true)).toBe('Xong');
    expect(statusTag('ARRIVED', false)).toBe('In chair');
    expect(statusTag('CANCELLED', false)).toBe('');
    expect(cardInk('PENDING')).toBe('var(--ink-warn)');
  });
});
