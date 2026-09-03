import { buildRoadmap, manualTaskIds, periodKey, asTier, TASKS, PHASES, TIERS } from './seo-roadmap';

describe('the Maps roadmap board', () => {
  it('lets the numbers decide a measured task, both ways', () => {
    const done = buildRoadmap({ 'review-count': 'pass' }, {});
    const notYet = buildRoadmap({ 'review-count': 'fail' }, {});
    const find = (r: ReturnType<typeof buildRoadmap>) =>
      r.phases.flatMap((p) => p.tasks).find((t) => t.id === 'review-count');

    expect(find(done)?.state).toBe('done');
    expect(find(notYet)?.state).toBe('todo');
    expect(find(done)?.auto).toBe(true);
  });

  it('says "cannot see it" rather than "not done" when nothing was measured', () => {
    // The distinction the whole board rests on. A salon that has not connected
    // Google Business Profile has not FAILED the keyword task — we simply
    // cannot see it, and painting that red sends someone to fix a non-problem.
    const none = buildRoadmap({}, {});
    const unknown = buildRoadmap({ 'review-velocity': 'unknown' }, {});
    const pick = (r: ReturnType<typeof buildRoadmap>, id: string) =>
      r.phases.flatMap((p) => p.tasks).find((t) => t.id === id);

    expect(pick(none, 'review-count')?.state).toBe('unknown');
    expect(pick(unknown, 'review-velocity')?.state).toBe('unknown');
  });

  it('never offers an unknown task as the next thing to do', () => {
    // Nobody can act on a task whose state we cannot read, and putting one
    // here would stall the board permanently at the same row.
    const r = buildRoadmap({}, {});
    expect(r.next?.state).toBe('todo');
    expect(r.next?.auto).toBe(false);
  });

  it('walks the phases in order when picking what is next', () => {
    const r = buildRoadmap({}, {});
    const firstManual = TASKS.find((t) => t.kind === 'manual');
    expect(r.next?.id).toBe(firstManual?.id);
    expect(r.next?.phase).toBe(0);

    // Tick it, and the board moves on rather than repeating itself.
    const after = buildRoadmap({}, { [firstManual!.id]: { done: true } });
    expect(after.next?.id).not.toBe(firstManual?.id);
  });

  it('records who ticked a manual task and when', () => {
    const r = buildRoadmap({}, { 'verify-gbp': { done: true, at: '2026-09-03T10:00:00Z', by: 'an@lumio.vn' } });
    const t = r.phases.flatMap((p) => p.tasks).find((x) => x.id === 'verify-gbp');
    expect(t?.state).toBe('done');
    expect(t?.by).toBe('an@lumio.vn');
  });

  it('refuses to let a person tick a measured task', () => {
    // Allowing an override would make every green box on the board a maybe.
    const ids = manualTaskIds();
    for (const t of TASKS) {
      expect(ids.includes(t.id)).toBe(t.kind === 'manual');
    }
    // A tick stored against a measured id is ignored, not honoured.
    const r = buildRoadmap({ 'review-count': 'fail' }, { 'review-count': { done: true } });
    expect(r.phases.flatMap((p) => p.tasks).find((t) => t.id === 'review-count')?.state).toBe('todo');
  });

  it('counts progress per phase and overall', () => {
    const r = buildRoadmap({ 'review-count': 'pass', 'review-velocity': 'pass' }, { 'verify-gbp': { done: true } });
    expect(r.done).toBe(3);
    expect(r.total).toBe(TASKS.filter((t) => t.tiers.includes('medium')).length);
    const p2 = r.phases.find((p) => p.n === 2);
    expect(p2?.done).toBe(2);
  });

  it('keeps the catalog well-formed', () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const t of TASKS) {
      // Every task belongs to a phase that exists, or it renders nowhere.
      expect(PHASES.some((p) => p.n === t.phase)).toBe(true);
      // A measured task without a source would silently become permanently
      // unknown — a row nobody can ever clear.
      if (t.kind === 'check') expect(t.from?.key).toBeTruthy();
      // A manual task with no time estimate cannot be scheduled into a week.
      if (t.kind === 'manual') expect(t.minutes).toBeGreaterThan(0);
      // A task belonging to no tier renders for nobody.
      expect(t.tiers.length).toBeGreaterThan(0);
    }
    // Every phase has work in it.
    for (const p of PHASES) expect(TASKS.some((t) => t.phase === p.n)).toBe(true);
  });

  it('gives a crowded market more work than a small town', () => {
    const low = buildRoadmap({}, {}, 'low');
    const high = buildRoadmap({}, {}, 'high');
    expect(high.total).toBeGreaterThan(low.total);

    // And the small town is not sent to buy backlinks it does not need.
    const lowIds = low.phases.flatMap((p) => p.tasks).map((t) => t.id);
    expect(lowIds).not.toContain('link-chamber');
    expect(lowIds).not.toContain('citation-core');
    expect(low.phases.find((p) => p.n === 4)?.weeksLeft).toBeNull();
  });

  it('quotes a longer timeline where it is more crowded', () => {
    const low = buildRoadmap({}, {}, 'low').weeksToGoal;
    const high = buildRoadmap({}, {}, 'high').weeksToGoal;
    expect(high[1]).toBeGreaterThan(low[1]);
    expect(low[0]).toBeGreaterThan(0);
  });

  it('stops counting weeks for a phase that is finished', () => {
    const ticks: Record<string, { done: boolean; at: string }> = {};
    const at = new Date().toISOString();
    for (const t of TASKS.filter((x) => x.phase === 0 && x.kind === 'manual')) ticks[t.id] = { done: true, at };
    const r = buildRoadmap({ 'keyword-match': 'pass', 'search-share': 'pass' }, ticks, 'medium');
    expect(r.phases.find((p) => p.n === 0)?.weeksLeft).toBeNull();
  });
});

describe('recurring work expires with its period', () => {
  const WEEKLY = TASKS.find((t) => t.cadence === 'weekly')!;
  const NOW = new Date('2026-09-03T12:00:00Z'); // a Thursday

  it('counts a weekly job as done only inside the week it was ticked', () => {
    const thisWeek = buildRoadmap({}, { [WEEKLY.id]: { done: true, at: '2026-09-01T09:00:00Z' } }, 'medium', NOW);
    const lastWeek = buildRoadmap({}, { [WEEKLY.id]: { done: true, at: '2026-08-25T09:00:00Z' } }, 'medium', NOW);
    const pick = (r: ReturnType<typeof buildRoadmap>) =>
      r.phases.flatMap((p) => p.tasks).find((t) => t.id === WEEKLY.id);

    expect(pick(thisWeek)?.state).toBe('done');
    // The failure this prevents: "post 2-3x a week", ticked in March, still
    // green in June, while nobody has posted since.
    expect(pick(lastWeek)?.state).toBe('todo');
    expect(pick(lastWeek)?.recurring).toBe(true);
  });

  it('keys periods the way a shop experiences them', () => {
    // Sunday and Monday are different weeks to a salon, and to ISO.
    expect(periodKey('weekly', new Date('2026-09-06T12:00:00Z')))
      .not.toBe(periodKey('weekly', new Date('2026-09-07T12:00:00Z')));
    // Month and quarter roll over on the real boundary.
    expect(periodKey('monthly', new Date('2026-09-30T23:00:00Z'))).toBe('2026-09');
    expect(periodKey('monthly', new Date('2026-10-01T01:00:00Z'))).toBe('2026-10');
    expect(periodKey('quarterly', new Date('2026-09-30T12:00:00Z'))).toBe('2026-Q3');
    expect(periodKey('quarterly', new Date('2026-10-01T12:00:00Z'))).toBe('2026-Q4');
    // A one-off never expires.
    expect(periodKey('once', new Date('2020-01-01T00:00:00Z'))).toBe(periodKey('once', NOW));
  });

  it('a one-off ticked long ago stays done', () => {
    const r = buildRoadmap({}, { 'verify-gbp': { done: true, at: '2024-01-01T00:00:00Z' } }, 'medium', NOW);
    expect(r.phases.flatMap((p) => p.tasks).find((t) => t.id === 'verify-gbp')?.state).toBe('done');
  });
});

describe('the competition tier', () => {
  it('falls back to medium for anything unrecognised', () => {
    // Being told to do slightly too much is a smaller failure than being told
    // to do too little and wondering for six months why nothing moved.
    for (const bad of [null, undefined, '', 'HIGH ', 'enormous', 7]) expect(asTier(bad)).toBe('medium');
    for (const t of TIERS) expect(asTier(t)).toBe(t);
  });
});
