import {
  buildRoadmap, manualTaskIds, periodKey, asTier,
  TASKS, PHASES, WEB_TASKS, WEB_PHASES, TIERS, TRACKS,
  allTasks, allPhases, type Track,
} from './seo-roadmap';

type View = ReturnType<typeof buildRoadmap>;
const trackOf = (r: View, track: Track) => r.tracks.find((t) => t.track === track)!;
const tasksOf = (r: View, track: Track) => trackOf(r, track).phases.flatMap((p) => p.tasks);
const everything = (r: View) => r.tracks.flatMap((t) => t.phases.flatMap((p) => p.tasks));
const pick = (r: View, id: string) => everything(r).find((t) => t.id === id);

describe('the Maps track', () => {
  it('lets the numbers decide a measured task, both ways', () => {
    const done = buildRoadmap({ 'review-count': 'pass' }, {});
    const notYet = buildRoadmap({ 'review-count': 'fail' }, {});

    expect(pick(done, 'review-count')?.state).toBe('done');
    expect(pick(notYet, 'review-count')?.state).toBe('todo');
    expect(pick(done, 'review-count')?.auto).toBe(true);
  });

  it('says "cannot see it" rather than "not done" when nothing was measured', () => {
    // The distinction the whole board rests on. A salon that has not connected
    // Google Business Profile has not FAILED the keyword task — we simply
    // cannot see it, and painting that red sends someone to fix a non-problem.
    const none = buildRoadmap({}, {});
    const unknown = buildRoadmap({ 'review-velocity': 'unknown' }, {});

    expect(pick(none, 'review-count')?.state).toBe('unknown');
    expect(pick(unknown, 'review-velocity')?.state).toBe('unknown');
  });

  it('never offers an unknown task as the next thing to do', () => {
    // Nobody can act on a task whose state we cannot read, and putting one
    // here would stall the board permanently at the same row.
    const r = buildRoadmap({}, {});
    for (const t of r.tracks) {
      expect(t.next?.state).toBe('todo');
      expect(t.next?.auto).toBe(false);
    }
  });

  it('walks the phases in order when picking what is next', () => {
    const r = buildRoadmap({}, {});
    const firstManual = TASKS.find((t) => t.kind === 'manual');
    expect(trackOf(r, 'map').next?.id).toBe(firstManual?.id);
    expect(trackOf(r, 'map').next?.phase).toBe(0);

    // Tick it, and the board moves on rather than repeating itself.
    const after = buildRoadmap({}, { [firstManual!.id]: { done: true, at: new Date().toISOString() } });
    expect(trackOf(after, 'map').next?.id).not.toBe(firstManual?.id);
  });

  it('records who ticked a manual task and when', () => {
    const r = buildRoadmap({}, { 'verify-gbp': { done: true, at: '2026-09-03T10:00:00Z', by: 'an@lumio.vn' } });
    expect(pick(r, 'verify-gbp')?.state).toBe('done');
    expect(pick(r, 'verify-gbp')?.by).toBe('an@lumio.vn');
  });

  it('counts progress per phase and per track', () => {
    const r = buildRoadmap({ 'review-count': 'pass', 'review-velocity': 'pass' }, { 'verify-gbp': { done: true } });
    const map = trackOf(r, 'map');
    expect(map.done).toBe(3);
    expect(map.total).toBe(TASKS.filter((t) => t.tiers.includes('medium')).length);
    expect(map.phases.find((p) => p.n === 2)?.done).toBe(2);
  });

  it('gives a crowded market more work than a small town', () => {
    const low = trackOf(buildRoadmap({}, {}, 'low'), 'map');
    const high = trackOf(buildRoadmap({}, {}, 'high'), 'map');
    expect(high.total).toBeGreaterThan(low.total);

    // And the small town is not sent to chase links it does not need.
    const lowIds = low.phases.flatMap((p) => p.tasks).map((t) => t.id);
    expect(lowIds).not.toContain('link-chamber');
    expect(lowIds).not.toContain('citation-core');
    expect(low.phases.find((p) => p.n === 4)?.weeksLeft).toBeNull();
  });

  it('quotes a longer timeline where it is more crowded', () => {
    const low = trackOf(buildRoadmap({}, {}, 'low'), 'map').weeksToGoal;
    const high = trackOf(buildRoadmap({}, {}, 'high'), 'map').weeksToGoal;
    expect(high[1]).toBeGreaterThan(low[1]);
    expect(low[0]).toBeGreaterThan(0);
  });

  it('stops counting weeks for a phase that is finished', () => {
    const ticks: Record<string, { done: boolean; at: string }> = {};
    const at = new Date().toISOString();
    for (const t of TASKS.filter((x) => x.phase === 0 && x.kind === 'manual')) ticks[t.id] = { done: true, at };
    const r = buildRoadmap({ 'keyword-match': 'pass', 'search-share': 'pass' }, ticks, 'medium');
    expect(trackOf(r, 'map').phases.find((p) => p.n === 0)?.weeksLeft).toBeNull();
  });
});

describe('the keyword and website track', () => {
  it('stands on its own, next to the map track', () => {
    const r = buildRoadmap({}, {});
    expect(r.tracks.map((t) => t.track)).toEqual(TRACKS);
    // Each track advances by itself: clearing map work must not skip web work.
    expect(trackOf(r, 'web').next?.track).toBe('web');
    expect(trackOf(r, 'web').total).toBeGreaterThan(0);
  });

  it('teaches the on-page checklist rather than paraphrasing it', () => {
    // These rows exist to carry P-series items to the person doing the work.
    // Losing the citation turns them back into vague advice.
    const ids = WEB_TASKS.map((t) => t.id);
    for (const id of ['w-p1-p5-meta', 'w-p8-coverage', 'w-p14-p16-answer', 'w-p17-p18-links']) {
      expect(ids).toContain(id);
    }
    const linkTask = WEB_TASKS.find((t) => t.id === 'w-p17-p18-links')!;
    expect(JSON.stringify(linkTask)).toMatch(/P18/);
  });

  it('never sends anyone to buy a link, a listing or a visitor', () => {
    // The whole track is manual by instruction. A single "buy" slipping into
    // the catalog would be read as permission for all of it.
    const words = /(mua backlink|mua traffic|mua link|buy (a )?(backlink|traffic|link)s?|paid link)/i;
    for (const t of WEB_TASKS) {
      const text = `${JSON.stringify(t.title)} ${JSON.stringify(t.how)}`;
      expect(text).not.toMatch(words);
    }
    // And it says so out loud somewhere, so the person reading knows it is a
    // rule and not an omission.
    expect(JSON.stringify(WEB_TASKS)).toMatch(words);
  });

  it('teaches a free way to find keywords, not just an instruction to find them', () => {
    // "Lập danh sách từ khoá" with no method is where every one of these plans
    // stalls, and the paid tools are out of reach for a salon. The row has to
    // carry the actual free sources or it carries nothing.
    const t = WEB_TASKS.find((x) => x.id === 'w-keyword-free-research');
    expect(t).toBeTruthy();
    const how = JSON.stringify(t!.how);
    for (const source of ['gợi ý tự động', 'Mọi người cũng hỏi', 'Trends']) {
      expect(how).toContain(source);
    }
  });

  it('joins the two tracks rather than leaving them to drift', () => {
    // The map profile and the site borrow authority from each other, and a
    // board that never says so lets a salon run both halves as strangers.
    expect(WEB_TASKS.map((t) => t.id)).toContain('w-link-gbp-web');
  });

  it('quotes a longer road than the map, because it is one', () => {
    // Ranking a page for a keyword takes longer than tidying a map listing,
    // and a board that implied otherwise would lose the client in month three.
    const r = buildRoadmap({}, {}, 'high');
    expect(trackOf(r, 'web').weeksToGoal[1]).toBeGreaterThan(trackOf(r, 'map').weeksToGoal[1]);
  });
});

describe('an older screen must not be broken by a newer server', () => {
  // This is not tidiness. The API and the web app deploy as two services, so on
  // every release one of them is a version behind the other for a few minutes.
  // The release that introduced `tracks` moved `weeksToGoal` inside it, and a
  // web bundle still on the old build called monthsText(undefined) — "e is not
  // iterable", and a live salon's whole content screen became a stack trace:
  // the ideas, the calendar and the post queue with it.
  const OLD_FIELDS = ['phases', 'done', 'total', 'next', 'weeksToGoal'] as const;

  it('still answers in the shape the previous screen reads', () => {
    const r = buildRoadmap({}, {}) as unknown as Record<string, unknown>;
    for (const f of OLD_FIELDS) expect(r[f]).toBeDefined();
    expect(Array.isArray(r.weeksToGoal)).toBe(true);
    expect((r.weeksToGoal as number[]).length).toBe(2);
    expect(Array.isArray(r.phases)).toBe(true);
  });

  it('mirrors the map track exactly, so the old screen shows the truth', () => {
    // Answering with the right shape and the wrong numbers would be worse than
    // crashing: nobody would notice.
    const r = buildRoadmap({ 'review-count': 'pass' }, { 'verify-gbp': { done: true } }, 'high');
    const map = trackOf(r, 'map');
    expect(r.phases).toBe(map.phases);
    expect(r.done).toBe(map.done);
    expect(r.total).toBe(map.total);
    expect(r.next?.id).toBe(map.next?.id);
    expect(r.weeksToGoal).toEqual(map.weeksToGoal);
  });
});

describe('what is due right now', () => {
  const NOW = new Date('2026-09-03T12:00:00Z'); // a Thursday

  it('puts overdue recurring work ahead of the next new job', () => {
    // A missed week of asking for reviews cannot be made up later; a one-off
    // waits without decaying. So the recurring rows come first.
    const r = buildRoadmap({}, {}, 'medium', NOW);
    const firstOneOff = r.dueNow.findIndex((t) => !t.recurring);
    const lastRecurring = r.dueNow.map((t) => t.recurring).lastIndexOf(true);
    expect(firstOneOff).toBeGreaterThan(lastRecurring);
  });

  it('offers one next step per track, never an unknown one', () => {
    const r = buildRoadmap({}, {}, 'medium', NOW);
    const oneOffs = r.dueNow.filter((t) => !t.recurring);
    expect(new Set(oneOffs.map((t) => t.track)).size).toBe(oneOffs.length);
    for (const t of r.dueNow) expect(t.state).toBe('todo');
  });

  it('drops a job the moment it is ticked for this period', () => {
    const weekly = allTasks().find((t) => t.cadence === 'weekly' && t.tiers.includes('medium'))!;
    const before = buildRoadmap({}, {}, 'medium', NOW);
    const after = buildRoadmap({}, { [weekly.id]: { done: true, at: '2026-09-01T09:00:00Z' } }, 'medium', NOW);
    expect(before.dueNow.map((t) => t.id)).toContain(weekly.id);
    expect(after.dueNow.map((t) => t.id)).not.toContain(weekly.id);
  });
});

describe('the catalog', () => {
  it('stays well-formed across both tracks', () => {
    const tasks = allTasks();
    const phases = allPhases();
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    for (const t of tasks) {
      // Every task belongs to a phase ON ITS OWN TRACK, or it renders nowhere.
      expect(phases.some((p) => p.track === t.track && p.n === t.phase)).toBe(true);
      // A measured task without a source would silently become permanently
      // unknown — a row nobody can ever clear.
      if (t.kind === 'check') expect(t.from?.key).toBeTruthy();
      // A manual task with no time estimate cannot be scheduled into a week.
      if (t.kind === 'manual') expect(t.minutes).toBeGreaterThan(0);
      // A task belonging to no tier renders for nobody.
      expect(t.tiers.length).toBeGreaterThan(0);
    }
    // Every phase has work in it, on its own track.
    for (const p of phases) expect(tasks.some((t) => t.track === p.track && t.phase === p.n)).toBe(true);
    // The two catalogs do not bleed into each other.
    for (const t of TASKS) expect(t.track).toBe('map');
    for (const t of WEB_TASKS) expect(t.track).toBe('web');
    for (const p of PHASES) expect(p.track).toBe('map');
    for (const p of WEB_PHASES) expect(p.track).toBe('web');
  });

  it('refuses to let a person tick a measured task, on either track', () => {
    // Allowing an override would make every green box on the board a maybe.
    const ids = manualTaskIds();
    for (const t of allTasks()) expect(ids.includes(t.id)).toBe(t.kind === 'manual');

    // A tick stored against a measured id is ignored, not honoured.
    const r = buildRoadmap({ 'review-count': 'fail' }, { 'review-count': { done: true } });
    expect(pick(r, 'review-count')?.state).toBe('todo');
  });
});

describe('recurring work expires with its period', () => {
  const WEEKLY = TASKS.find((t) => t.cadence === 'weekly')!;
  const NOW = new Date('2026-09-03T12:00:00Z'); // a Thursday

  it('counts a weekly job as done only inside the week it was ticked', () => {
    const thisWeek = buildRoadmap({}, { [WEEKLY.id]: { done: true, at: '2026-09-01T09:00:00Z' } }, 'medium', NOW);
    const lastWeek = buildRoadmap({}, { [WEEKLY.id]: { done: true, at: '2026-08-25T09:00:00Z' } }, 'medium', NOW);

    expect(pick(thisWeek, WEEKLY.id)?.state).toBe('done');
    // The failure this prevents: "post 2-3x a week", ticked in March, still
    // green in June, while nobody has posted since.
    expect(pick(lastWeek, WEEKLY.id)?.state).toBe('todo');
    expect(pick(lastWeek, WEEKLY.id)?.recurring).toBe(true);
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
    expect(pick(r, 'verify-gbp')?.state).toBe('done');
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
