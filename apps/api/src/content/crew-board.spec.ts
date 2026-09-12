import { splitCrew, crewJobs, sortCrew, groupByKind, crewCounts, jobDate, CREW_KINDS, type WeekRowLike } from './crew-board';
import { attachBriefs } from './job-brief';
import { bi } from './i18n';
import type { DayPlan } from './weekly-plan';

const days = (): DayPlan[] => attachBriefs([
  { weekday: 1, label: bi('Thứ 2', 'Mon'), jobs: [
    { kind: 'film', text: bi('Quay 3 clip', 'Film 3 clips'), why: '' },
    { kind: 'post', text: bi('Đăng clip 1', 'Post clip 1'), why: '' },
  ] },
  { weekday: 2, label: bi('Thứ 3', 'Tue'), jobs: [
    { kind: 'gbp', text: bi('Đăng lên hồ sơ Google', 'Post to the Google profile'), why: '' },
    { kind: 'rest', text: bi('Nghỉ', 'Rest'), why: '' },
  ] },
  { weekday: 3, label: bi('Thứ 4', 'Wed'), jobs: [
    { kind: 'story', text: bi('Story hậu trường', 'Behind the scenes'), why: '' },
  ] },
], {});

const row = (tenantId: string, salon: string, crew: Record<string, unknown> | null = null): WeekRowLike => ({
  tenantId, salon, slug: salon.toLowerCase(), weekKey: '2026-W37', startDate: '2026-09-07',
  days: days(), crew: crew as never,
});
const idOf = (di: number, ji: number) => days()[di].jobs[ji].id!;

describe('crewJobs', () => {
  it('takes Lumio\'s own work and leaves the shop\'s alone', () => {
    const jobs = crewJobs([row('t1', 'A')], { today: '2026-09-09' });
    expect(jobs.map((j) => j.kind).sort()).toEqual(['gbp', 'post', 'story']);
    for (const j of jobs) expect(CREW_KINDS).toContain(j.kind);
    // Filming is the salon's errand and never appears on the production queue.
    expect(jobs.some((j) => j.kind === 'film')).toBe(false);
  });

  it('turns the plan\'s day index into a real date and counts how late it is', () => {
    expect(jobDate('2026-09-07', 2)).toBe('2026-09-09');
    const jobs = crewJobs([row('t1', 'A')], { today: '2026-09-09' });
    const post = jobs.find((j) => j.kind === 'post')!;   // Monday
    const story = jobs.find((j) => j.kind === 'story')!; // Wednesday = today
    expect(post.due).toBe('2026-09-07');
    expect(post.lateDays).toBe(2);
    expect(story.lateDays).toBe(0);
  });

  it('shows two days ahead and no further — the screen answers "what now", not "what ever"', () => {
    // Monday is today: Tuesday and Wednesday are one and two days ahead, both in.
    const jobs = crewJobs([row('t1', 'A')], { today: '2026-09-07' });
    expect(jobs.map((j) => j.kind).sort()).toEqual(['gbp', 'post', 'story']);
    // Horizon 0 is the strictest reading of "today": nothing borrowed from tomorrow.
    expect(crewJobs([row('t1', 'A')], { today: '2026-09-07', horizonDays: 0 }).map((j) => j.kind)).toEqual(['post']);
    expect(crewJobs([row('t1', 'A')], { today: '2026-09-07', horizonDays: 1 }).map((j) => j.kind).sort()).toEqual(['gbp', 'post']);
  });

  it('carries who holds a job, so a colleague who is off is not a gap', () => {
    const held = { [idOf(0, 1)]: { by: 'linh@lumio.vn', at: '2026-09-08T02:00:00Z' } };
    const j = crewJobs([row('t1', 'A', held)], { today: '2026-09-09' }).find((x) => x.kind === 'post')!;
    expect(j.by).toBe('linh@lumio.vn');
    expect(j.heldAt).toBe('2026-09-08T02:00:00Z');
    expect(j.done).toBe(false);
  });

  it('splits the roles as a hint, never as a wall', () => {
    const jobs = crewJobs([row('t1', 'A')], { today: '2026-09-09' });
    expect(jobs.find((j) => j.kind === 'post')!.role).toBe('design');
    expect(jobs.find((j) => j.kind === 'gbp')!.role).toBe('content');
  });
});

describe('the order and the grouping', () => {
  it('puts late work first, and unclaimed before claimed on the same day', () => {
    const mine = { [idOf(0, 1)]: { by: 'linh@lumio.vn', at: '2026-09-08T02:00:00Z' } };
    const jobs = sortCrew(crewJobs([row('t1', 'Alpha', mine), row('t2', 'Beta')], { today: '2026-09-09' }));
    // Both salons' Monday posts are two days late; Beta's is unheld, so it leads.
    expect(jobs[0]).toMatchObject({ salon: 'Beta', kind: 'post', lateDays: 2, by: null });
    expect(jobs[1]).toMatchObject({ salon: 'Alpha', kind: 'post', by: 'linh@lumio.vn' });
  });

  it('EVERY field that reaches the browser is a string, headings included', () => {
    // React refuses to render a { vi, en } pair and takes the whole page down
    // with it. The job text was flattened and the group heading was not, so
    // the screen died on its own title. Nothing bilingual leaves this module.
    for (const lang of ['vi', 'en'] as const) {
      const g = groupByKind(crewJobs([row('t1', 'A')], { today: '2026-09-09', lang }), lang);
      for (const grp of g) {
        expect(typeof grp.label).toBe('string');
        for (const j of grp.jobs) {
          expect(typeof j.text).toBe('string');
          for (const st of j.steps) expect(typeof st).toBe('string');
        }
      }
      // The strongest form of the check: no object anywhere under a key the
      // screen prints, whatever gets added to CrewJob later.
      expect(JSON.stringify(g)).not.toMatch(/"(vi|en)":/);
    }
    expect(groupByKind(crewJobs([row('t1', 'A')], { today: '2026-09-09' }), 'vi')[0].label).toBe('Đăng bài');
    expect(groupByKind(crewJobs([row('t1', 'A')], { today: '2026-09-09', lang: 'en' }), 'en')[0].label).toBe('Posts');
  });

  it('groups by kind with the biggest batch first — the batch IS the saving', () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(`t${i}`, `S${i}`));
    const g = groupByKind(crewJobs(rows, { today: '2026-09-09' }));
    expect(g.map((x) => x.jobs.length)).toEqual([4, 4, 4]);
    expect(g.every((x) => x.jobs.every((j) => j.kind === x.kind))).toBe(true);
  });

  it('counts what the header needs: open, mine, late, done', () => {
    const held = {
      [idOf(0, 1)]: { by: 'linh@lumio.vn', at: 'x' },
      [idOf(1, 0)]: { by: 'nam@lumio.vn', at: 'x', done: true },
    };
    const c = crewCounts(crewJobs([row('t1', 'A', held)], { today: '2026-09-09' }), 'linh@lumio.vn');
    // Monday's post is late and held by me; Tuesday's gbp is late but DONE, so it
    // is counted as done and not as late — a finished job is not a debt.
    // Wednesday's story is today's, unheld.
    // `waiting` is 0 here: no media map was passed, so nothing is known to be
    // blocked and the board behaves exactly as it did before the lane existed.
    expect(c).toEqual({ open: 1, mine: 1, late: 1, done: 1, waiting: 0 });
  });
});

/**
 * "A job whose material has not arrived is not work — it is a phone call."
 * The header of crew-board.ts promised this lane from the beginning and it was
 * never built, so a designer picked up "Đăng clip" and found nothing to edit.
 */
describe('the lane for work that is really a phone call', () => {
  const held = {};

  it('marks a post as waiting when the shop has sent nothing this week', () => {
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], {
      today: '2026-09-09',
      lastMediaByTenant: { t1: null },
    });
    const post = jobs.find((j) => j.kind === 'post')!;
    expect(post.material).toBe('waiting');
    expect(post.waitingDays).toBeGreaterThanOrEqual(0);
  });

  it('counts media from BEFORE this week as not arrived', () => {
    // A clip sent three weeks ago is not material for Tuesday's post.
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], {
      today: '2026-09-09',
      lastMediaByTenant: { t1: '2026-08-20' },
    });
    expect(jobs.find((j) => j.kind === 'post')!.material).toBe('waiting');
  });

  it('clears the whole salon the moment anything arrives for the week', () => {
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], {
      today: '2026-09-09',
      lastMediaByTenant: { t1: '2026-09-08' },
    });
    expect(jobs.filter((j) => j.material === 'waiting')).toHaveLength(0);
  });

  it('never blocks work that needs no footage at all', () => {
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], {
      today: '2026-09-09',
      lastMediaByTenant: { t1: null },
    });
    for (const j of jobs) {
      if (j.kind === 'gbp' || j.kind === 'winback' || j.kind === 'engage') {
        expect(j.material).toBe('not-needed');
      }
    }
  });

  it('behaves exactly as before when no media map is given at all', () => {
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], { today: '2026-09-09' });
    expect(jobs.every((j) => j.material !== 'waiting')).toBe(true);
  });

  it('splits the morning into work and calls, and one call per salon', () => {
    const jobs = crewJobs(
      [row('t1', 'Lux Nails', held), row('t2', 'Bella Nails', held)],
      { today: '2026-09-09', lastMediaByTenant: { t1: null, t2: '2026-09-08' } },
    );
    const s = splitCrew(jobs);
    expect(s.ready.every((j) => j.material !== 'waiting')).toBe(true);
    expect(s.blocked.every((j) => j.material === 'waiting')).toBe(true);
    expect(s.blocked.every((j) => j.salon === 'Lux Nails')).toBe(true);
    // Several stuck jobs are still ONE phone call.
    expect(s.chase).toHaveLength(1);
    expect(s.chase[0]).toMatchObject({ salon: 'Lux Nails', tenantId: 't1' });
    expect(s.chase[0].jobs).toBe(s.blocked.length);
  });

  it('does not count a phone call as open work in the header', () => {
    // "14 việc" on a morning where four of them are four phone calls is how a
    // person plans a day they cannot have.
    const jobs = crewJobs([row('t1', 'Lux Nails', held)], {
      today: '2026-09-09', lastMediaByTenant: { t1: null },
    });
    const c = crewCounts(jobs, null);
    expect(c.waiting).toBeGreaterThan(0);
    expect(c.open).toBe(jobs.filter((j) => !j.done && j.material !== 'waiting').length);
  });
});
