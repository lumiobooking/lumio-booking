import {
  trimToBudget, photoJob, mapJob, longGameJob, longGameWeek, storyJobs,
  buildPrep, buildTargets, WEEK_BUDGET, PHOTO_COUNT, type Budgeted,
} from './content-mix';
import { playbookFor } from './industry-playbook';
import { buildWeekPlan } from './weekly-plan';
import { viOf, enOf } from './i18n';

const book = playbookFor('SALON');
const job = (kind: string, i: number): Budgeted =>
  ({ kind: kind as Budgeted['kind'], text: `${kind}-${i}`, why: '', day: i % 7 });

describe('a week a shop actually finishes', () => {
  it('never asks for more than the budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => job('post', i));
    expect(trimToBudget(many)).toHaveLength(WEEK_BUDGET);
  });

  it('drops the cheapest work first, and keeps the shoot', () => {
    const week: Budgeted[] = [
      job('story', 0), job('event', 1), job('winback', 2), job('film', 3),
      job('photo', 4), ...Array.from({ length: 8 }, (_, i) => job('post', i)),
    ];
    const kept = trimToBudget(week, 6).map((j) => j.kind);
    expect(kept).toContain('film');
    expect(kept).toContain('photo');
    expect(kept).not.toContain('story');
    expect(kept).not.toContain('event');
  });

  it('trims the same way twice — the plan does not reshuffle between two reads', () => {
    const week = Array.from({ length: 20 }, (_, i) => job(i % 2 ? 'post' : 'story', i));
    expect(trimToBudget(week, 7)).toEqual(trimToBudget(week, 7));
  });

  it('leaves a short week alone', () => {
    const week = [job('film', 0), job('post', 1)];
    expect(trimToBudget(week)).toHaveLength(2);
  });

  it('never counts a rest marker against the budget', () => {
    const week = [job('rest', 0), job('rest', 1), job('film', 2)];
    expect(trimToBudget(week, 2)).toHaveLength(1);
  });
});

describe('the work that is not a clip', () => {
  it('sends the shop out for stills, naming what to shoot from its own trade', () => {
    const p = photoJob(book, 0);
    expect(p.kind).toBe('photo');
    expect(viOf(p.text)).toContain(`Chụp ${PHOTO_COUNT} ảnh`);
    // The subjects come from the trade's own list, not a second one that would
    // drift away from it.
    const subjects = book.dailySources.map((s) => viOf(s.label));
    expect(subjects.some((sub) => viOf(p.text).includes(sub))).toBe(true);
  });

  it('gives the Google profile a different job each week, not the same line four times', () => {
    const four = [0, 1, 2, 3].map((w) => viOf(mapJob(w).text));
    expect(new Set(four).size).toBe(4);
    expect(viOf(mapJob(0).text)).toMatch(/hồ sơ Google/);
    // …and it comes back round rather than running out.
    expect(mapJob(4).text).toEqual(mapJob(0).text);
  });

  it('asks for something that is not a post only every other week', () => {
    expect(longGameWeek(0)).toBe(true);
    expect(longGameWeek(1)).toBe(false);
    expect(longGameWeek(2)).toBe(true);
  });

  it('rotates the long game so a shop does not run the same giveaway all year', () => {
    const seen = [0, 2, 4, 6].map((w) => viOf(longGameJob(book, w).text));
    expect(new Set(seen).size).toBe(4);
    expect(longGameJob(book, 0).kind).toBe('event');
  });

  it('names the trade inside the long game rather than saying "your business"', () => {
    const hair = longGameJob(playbookFor('HAIR'), 2);
    expect(viOf(hair.text)).toContain(viOf(playbookFor('HAIR').trade));
  });

  it('makes the second story a countdown when there is an offer, a poll when there is not', () => {
    expect(viOf(storyJobs(true)[1].text)).toMatch(/đếm ngược/);
    expect(viOf(storyJobs(false)[1].text)).toMatch(/bình chọn/i);
    expect(storyJobs(false)).toHaveLength(2);
  });
});

describe('what to carry in, and what it is for', () => {
  it('counts the clips and photos the week actually asks for', () => {
    const prep = buildPrep({ clips: 3, photos: true, posts: 4, book, week: 0 });
    expect(viOf(prep[0].label)).toBe('Quay 3 clip');
    expect(viOf(prep[1].label)).toBe('Chụp 6 ảnh');
    expect(viOf(prep[2].label)).toBe('Viết 4 caption');
  });

  it('says nothing about filming in a week with no shoot', () => {
    const prep = buildPrep({ clips: 0, photos: false, posts: 2, book, week: 1 });
    expect(prep.map((l) => viOf(l.label)).join(' ')).not.toMatch(/Quay/);
  });

  it('always ends on the permission line, whatever else the week holds', () => {
    // The one item that is not about production. A face posted without asking
    // is the fastest way to lose a regular, and it is never on anybody's list.
    for (const clips of [0, 3]) {
      const prep = buildPrep({ clips, photos: false, posts: 0, book, week: 0 });
      expect(viOf(prep[prep.length - 1].label)).toMatch(/Xin phép/);
    }
  });

  it('caps the weekly review ask, however far the shop still has to go', () => {
    const prep = buildPrep({ clips: 0, photos: false, posts: 0, book, week: 0, reviewsNeeded: 40 });
    expect(viOf(prep[0].label)).toBe('Xin 7 đánh giá Google');
  });

  it('turns the week into numbers next week can check', () => {
    const t = buildTargets({
      jobs: [{ kind: 'post' }, { kind: 'post' }, { kind: 'story' }],
      reviewsNeeded: 5,
      quietSlot: { vi: 'Thứ 7 buổi sáng', en: 'Sat morning' },
    });
    const labels = t.map((x) => viOf(x.label));
    expect(labels).toContain('Bài đã đăng');
    expect(t.find((x) => viOf(x.label) === 'Bài đã đăng')?.target).toBe(2);
    expect(t.find((x) => viOf(x.label) === 'Đánh giá Google mới')?.target).toBe(5);
    expect(labels.some((l) => l.includes('Thứ 7 buổi sáng'))).toBe(true);
  });

  it('offers no target it cannot count', () => {
    // No posts, no reviews owed, no offer → nothing claimed. A target list
    // padded with moods is a list nobody checks.
    expect(buildTargets({ jobs: [] })).toEqual([]);
  });
});

describe('the whole week, once the new work is in it', () => {
  const p = buildWeekPlan({ today: new Date('2026-09-05T12:00:00Z'), todayWeekday: 6, industry: 'SALON', week: 0 });
  const all = p.days.flatMap((d) => d.jobs);

  it('IS NO LONGER A LIST OF CLIPS', () => {
    const kinds = new Set(all.map((j) => j.kind));
    expect(kinds.has('photo')).toBe(true);
    expect(kinds.has('story')).toBe(true);
    expect(kinds.has('event')).toBe(true);
    expect([...kinds].some((k) => k === 'gbp' || k === 'engage')).toBe(true);
  });

  it('mixes stills into the posts instead of publishing four clips', () => {
    const posts = all.filter((j) => j.kind === 'post').map((j) => viOf(j.text));
    expect(posts.some((t) => t.startsWith('Đăng clip'))).toBe(true);
    expect(posts.some((t) => t.startsWith('Đăng bộ ảnh'))).toBe(true);
  });

  it('still leaves one day genuinely empty, now that the week is fuller', () => {
    expect(p.days.some((d) => d.jobs.every((j) => j.kind === 'rest'))).toBe(true);
  });

  it('stays inside the budget', () => {
    expect(all.filter((j) => j.kind !== 'rest').length).toBeLessThanOrEqual(WEEK_BUDGET);
  });

  it('carries its own prep list and its own targets', () => {
    expect(p.prep.length).toBeGreaterThan(2);
    expect(p.targets.length).toBeGreaterThan(0);
    // Derived, not restated: the caption count is the post count.
    const posts = all.filter((j) => j.kind === 'post').length;
    expect(viOf(p.prep.find((l) => viOf(l.label).includes('caption'))!.label)).toBe(`Viết ${posts} caption`);
  });

  it('says all of it in English too', () => {
    expect(enOf(p.prep[0].label)).not.toBe(viOf(p.prep[0].label));
    expect(enOf(p.targets[0].label)).not.toBe(viOf(p.targets[0].label));
  });
});
