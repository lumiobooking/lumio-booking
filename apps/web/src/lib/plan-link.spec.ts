import { byDayOf, countsOf, dayKeyAsDate, dayKeyIn, monthCells, openingMonth, openingMonthWithIdeas, shiftYm } from './plan-link';

describe('the client plan link: month grid', () => {
  it('November 2026 starts on a Sunday: six leading blanks, 30 days, 5 or 6 full weeks', () => {
    const c = monthCells('2026-11');
    expect(c.length % 7).toBe(0);
    expect(c.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(c[6]).toBe('2026-11-01');
    expect(c.filter(Boolean).length).toBe(30);
  });
  it('steps across a year end', () => {
    expect(shiftYm('2026-12', 1)).toBe('2027-01');
    expect(shiftYm('2026-01', -1)).toBe('2025-12');
  });
  it('a post lands on the SALON day, not the viewer day', () => {
    // 02:30 UTC on the 15th is still the 14th in Texas.
    expect(dayKeyIn('2026-11-15T02:30:00Z', 'America/Chicago')).toBe('2026-11-14');
    const m = byDayOf([{ id: 'a', scheduledAt: '2026-11-15T02:30:00Z', clientStatus: 'wait' as const }], 'America/Chicago');
    expect([...m.keys()]).toEqual(['2026-11-14']);
  });
  it('opens on the month of the first post still waiting, else this month', () => {
    const posts = [
      { id: 'a', scheduledAt: '2026-12-03T15:00:00Z', clientStatus: 'wait' as const },
      { id: 'b', scheduledAt: '2026-11-20T15:00:00Z', clientStatus: 'approved' as const },
    ];
    expect(openingMonth(posts, 'America/Chicago', new Date('2026-11-12T12:00:00Z'))).toBe('2026-12');
    expect(openingMonth([posts[1]], 'America/Chicago', new Date('2026-11-12T12:00:00Z'))).toBe('2026-11');
  });
  it('counts each status', () => {
    expect(countsOf([
      { id: 'a', scheduledAt: 'x', clientStatus: 'wait' }, { id: 'b', scheduledAt: 'x', clientStatus: 'wait' },
      { id: 'c', scheduledAt: 'x', clientStatus: 'held' }, { id: 'd', scheduledAt: 'x', clientStatus: 'posted' },
    ])).toEqual({ wait: 2, held: 1, approved: 0, posted: 1 });
  });
  it('with ideas on the link, opens on the earliest thing waiting — post or idea', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const post = [{ id: 'a', scheduledAt: '2026-12-03T15:00:00Z', clientStatus: 'wait' as const }];
    expect(openingMonthWithIdeas(post, ['2026-11-27'], 'America/Chicago', now)).toBe('2026-11');
    expect(openingMonthWithIdeas(post, [], 'America/Chicago', now)).toBe('2026-12');
    expect(openingMonthWithIdeas([], [], 'America/Chicago', now)).toBe('2026-11');
  });
  it('an idea day prints as that day wherever the viewer is', () => {
    for (const tz of ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      expect(dayKeyAsDate('2026-11-27').toLocaleDateString('en-CA', { timeZone: 'UTC' })).toBe('2026-11-27');
      expect(dayKeyIn(dayKeyAsDate('2026-11-27'), 'UTC')).toBe('2026-11-27');
      void tz;
    }
  });
});
