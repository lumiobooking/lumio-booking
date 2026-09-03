import { buildRoadmap, manualTaskIds, TASKS, PHASES } from './seo-roadmap';

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
    expect(r.total).toBe(TASKS.length);
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
    }
    // Every phase has work in it.
    for (const p of PHASES) expect(TASKS.some((t) => t.phase === p.n)).toBe(true);
  });
});
