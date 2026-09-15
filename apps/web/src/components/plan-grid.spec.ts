import { addDays, daysBetween, mondayIndex, layoutGrid, type AheadBlock, type GridPost } from './PlanGrid';

/**
 * The grid places two kinds of thing on calendar days: plan jobs, which come
 * in seven-day blocks starting on a given day, and posts, which are instants.
 * Both have to land on the SALON's day, and the blocks have to tile.
 */

const week = (from: string, weekKey: string, texts: string[]): AheadBlock => ({
  weekKey, label: weekKey, from, startDate: from, edited: false, approvedAt: null, ticks: {}, auto: {},
  week: {
    days: texts.map((t, i) => ({ weekday: i, label: `d${i}`, jobs: t ? [{ kind: 'post', text: t, why: '', id: `${weekKey}-${i}`, brief: { steps: ['a', 'b'] } }] : [] })),
    focus: '', basis: '', daily: [], sources: [], trade: '', week: 1, stage: { key: 's', step: 1 } as never,
  } as never,
});

describe('calendar arithmetic without a timezone in sight', () => {
  it('adds days across a month end and a leap day', () => {
    expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('knows Monday from Sunday', () => {
    expect(mondayIndex('2026-09-14')).toBe(0); // a Monday
    expect(mondayIndex('2026-09-20')).toBe(6); // a Sunday
    expect(daysBetween('2026-09-14', '2026-09-20')).toBe(6);
    expect(daysBetween('2026-09-20', '2026-09-14')).toBe(-6);
  });
});

describe('laying the plan onto days', () => {
  it('starts on this week\'s Monday and covers five weeks', () => {
    const days = layoutGrid([], [], '2026-09-16', 'America/Chicago'); // a Wednesday
    expect(days).toHaveLength(35);
    expect(days[0].key).toBe('2026-09-14');
    expect(days[2].today).toBe(true);
    expect(days[1].past).toBe(true);
    // the window is thirty days from today, inclusive
    expect(days.filter((d) => d.inWindow)).toHaveLength(30);
    expect(days[2 + 29].inWindow).toBe(true);
    expect(days[2 + 30].inWindow).toBe(false);
  });

  it('tiles seven-day blocks from their own first day, not from Monday', () => {
    // The plan has always been "seven days from today". A block starting on
    // Wednesday puts its day 0 on Wednesday, its day 6 on the next Tuesday.
    const blocks = [week('2026-09-16', '2026-W38', ['w1', '', '', '', '', '', 'w1-last']), week('2026-09-23', '2026-W39', ['w2', '', '', '', '', '', ''])];
    const days = layoutGrid(blocks, [], '2026-09-16', 'America/Chicago');
    const by = Object.fromEntries(days.map((d) => [d.key, d]));
    expect(by['2026-09-16'].jobs.map((j) => j.job.text)).toEqual(['w1']);
    expect(by['2026-09-22'].jobs.map((j) => j.job.text)).toEqual(['w1-last']);
    expect(by['2026-09-23'].jobs.map((j) => j.job.text)).toEqual(['w2']);
    // no day carries two blocks
    expect(days.every((d) => d.jobs.length <= 1)).toBe(true);
  });

  it('marks a job done only when every step is ticked, counting the queue\'s own ticks', () => {
    const b = week('2026-09-16', '2026-W38', ['job']);
    b.ticks = { '2026-W38-0': [0] };
    let days = layoutGrid([b], [], '2026-09-16', 'America/Chicago');
    expect(days.find((d) => d.key === '2026-09-16')!.jobs[0].done).toBe(false);
    b.auto = { '2026-W38-0': [1] };
    days = layoutGrid([b], [], '2026-09-16', 'America/Chicago');
    expect(days.find((d) => d.key === '2026-09-16')!.jobs[0].done).toBe(true);
  });

  it('puts a post on the SALON\'s day, not the viewer\'s', () => {
    // 02:30 UTC on the 17th is still the evening of the 16th in Chicago.
    const posts: GridPost[] = [{ id: 'p', channels: ['facebook'], message: 'hi', scheduledAt: '2026-09-17T02:30:00.000Z', status: 'scheduled' }];
    const days = layoutGrid([], posts, '2026-09-16', 'America/Chicago');
    expect(days.find((d) => d.key === '2026-09-16')!.posts.map((p) => p.id)).toEqual(['p']);
    expect(days.find((d) => d.key === '2026-09-17')!.posts).toHaveLength(0);
  });

  it('leaves cancelled and expired posts off the grid', () => {
    const posts: GridPost[] = [
      { id: 'a', channels: [], message: '', scheduledAt: '2026-09-18T15:00:00.000Z', status: 'cancelled' },
      { id: 'b', channels: [], message: '', scheduledAt: '2026-09-18T15:00:00.000Z', status: 'expired' },
      { id: 'c', channels: [], message: '', scheduledAt: '2026-09-18T15:00:00.000Z', status: 'posted' },
    ];
    const days = layoutGrid([], posts, '2026-09-16', 'America/Chicago');
    expect(days.find((d) => d.key === '2026-09-18')!.posts.map((p) => p.id)).toEqual(['c']);
  });
});
