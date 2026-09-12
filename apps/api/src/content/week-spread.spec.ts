import { spreadAcrossWeek, type Budgeted } from './content-mix';
import { buildWeekPlan } from './weekly-plan';
import { bi } from './i18n';

const job = (day: number, kind: string, pinned = false): Budgeted => ({
  kind: kind as Budgeted['kind'], day, pinned,
  text: bi(`${kind}@${day}`, `${kind}@${day}`), why: bi('x', 'x'),
});

const perDay = (jobs: Budgeted[]) => {
  const m = new Map<number, number>();
  for (const j of jobs) m.set(j.day, (m.get(j.day) ?? 0) + 1);
  return m;
};

describe('one job a day, not three on Friday and none on Monday', () => {
  it('is the reported bug: offsets that collide get evened out', () => {
    // Exactly the shape the offsets produced: everything piled on two days.
    const jobs = [0, 0, 0, 3, 3, 4, 4, 4].map((d, i) => job(d, `k${i}`));
    const before = perDay(jobs);
    expect(Math.max(...before.values())).toBe(3);

    const after = perDay(spreadAcrossWeek(jobs, { todayWeekday: 0, restWeekday: 6 }));
    expect(Math.max(...after.values())).toBeLessThanOrEqual(2);
    expect(after.get(6) ?? 0).toBe(0);          // the rest day stays empty
  });

  it('never moves a job whose day is the point', () => {
    const jobs = [job(2, 'film', true), job(2, 'photo', true), job(2, 'post'), job(2, 'engage'), job(2, 'gbp')];
    const out = spreadAcrossWeek(jobs, { todayWeekday: 5, restWeekday: 1 });
    const pinned = out.filter((j) => j.pinned);
    expect(pinned).toHaveLength(2);
    expect(pinned.every((j) => j.day === 2)).toBe(true);
  });

  it('puts a moved job on the nearest free day, not the first one it finds', () => {
    // Day 3 is taken; the job wanted day 3, so day 2 or 4 should win over day 0.
    const jobs = [job(3, 'film', true), job(3, 'post')];
    const out = spreadAcrossWeek(jobs, { todayWeekday: 0, restWeekday: null });
    const moved = out.find((j) => !j.pinned)!;
    expect([2, 4]).toContain(moved.day);
  });

  it('keeps the rest day empty while any other day has room', () => {
    const jobs = [0, 1, 2, 3, 4].map((d, i) => job(d, `k${i}`));
    const out = spreadAcrossWeek(jobs, { todayWeekday: 0, restWeekday: 2 });
    expect(out.some((j) => j.day === 2)).toBe(false);
  });

  it('gives the same answer twice — a plan that reshuffles is not a plan', () => {
    const jobs = [0, 0, 3, 3, 4, 5].map((d, i) => job(d, `k${i}`));
    const a = spreadAcrossWeek(jobs, { todayWeekday: 4, restWeekday: 3 });
    const b = spreadAcrossWeek(jobs, { todayWeekday: 4, restWeekday: 3 });
    expect(a.map((j) => `${j.kind}:${j.day}`)).toEqual(b.map((j) => `${j.kind}:${j.day}`));
  });

  it('keeps every job — evening out is not trimming', () => {
    const jobs = [0, 0, 0, 0, 1, 1, 2, 5].map((d, i) => job(d, `k${i}`));
    expect(spreadAcrossWeek(jobs, { todayWeekday: 0, restWeekday: 6 })).toHaveLength(jobs.length);
  });

  it('leaves a job alone rather than inventing a day when the week is full', () => {
    const jobs = Array.from({ length: 40 }, (_, i) => job(i % 7, `k${i}`));
    const out = spreadAcrossWeek(jobs, { todayWeekday: 0, restWeekday: 6 });
    expect(out).toHaveLength(40);
    expect(out.every((j) => j.day >= 0 && j.day <= 6)).toBe(true);
  });
});

describe('the real week a salon opens on Monday morning', () => {
  const realWeek = (todayWeekday: number) => buildWeekPlan({
    today: new Date('2026-09-14T09:00:00Z'),
    todayWeekday,
    loads: [], events: [], lapsed: null, advice: null,
    trade: 'nail', region: null, week: 3, lastWeek: null,
    city: 'Huntsville, AL', offer: null,
  } as Parameters<typeof buildWeekPlan>[0]);

  it('no longer leaves a working day with nothing while another carries three', () => {
    for (let today = 0; today < 7; today += 1) {
      const p = realWeek(today);
      const counts = p.days.map((d) => d.jobs.filter((j) => j.kind !== 'rest').length);
      expect(Math.max(...counts)).toBeLessThanOrEqual(2);
      // At most ONE empty day in the week, and it is the deliberate rest day.
      expect(counts.filter((n) => n === 0).length).toBeLessThanOrEqual(1);
    }
  });

  it('still hands the shop a full week of work, not a trimmed one', () => {
    const p = realWeek(1);
    const total = p.days.reduce((n, d) => n + d.jobs.filter((j) => j.kind !== 'rest').length, 0);
    expect(total).toBeGreaterThanOrEqual(8);
  });
});
