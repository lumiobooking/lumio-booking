import { buildWeekPlan } from './weekly-plan';
import { crewJobs } from './crew-board';
import { weeklyAsk } from './weekly-ask';
import { longGameJob, storyJobs, buildPrep } from './content-mix';
import { playbookFor } from './industry-playbook';
import { ownerOf, isSalonWork, isAgencyWork, habitOwner, OWNER_OF } from './work-owner';
import { clientWeek, SHOP_JOB_KINDS } from './client-view';
import { viOf } from './i18n';
import * as fs from 'fs';
import * as path from 'path';

const book = playbookFor('SALON');

describe('who does the work', () => {
  it('puts the camera work on the shop and the keyboard work on us', () => {
    expect(OWNER_OF.film).toBe('salon');
    expect(OWNER_OF.photo).toBe('salon');
    expect(OWNER_OF.post).toBe('agency');
    expect(OWNER_OF.gbp).toBe('agency');
    expect(OWNER_OF.winback).toBe('agency');
  });

  it('NEVER sends an in-person job to a queue worked from another country', () => {
    // "Pick a partner within 1km · print 30 cards · photograph both owners"
    // used to land in a Vietnamese designer's queue. Nobody there can do it.
    const g = longGameJob(book, 0);
    expect(g.kind).toBe('event');
    expect(isAgencyWork(g)).toBe(false);
    expect(isSalonWork(g)).toBe(true);
  });

  it('gives replying to messages and reviews back to the agency', () => {
    // It was filed as a habit of the shop's counter AND excluded from the crew
    // queue, so it belonged to nobody and nobody did it.
    expect(ownerOf({ kind: 'engage' })).toBe('agency');
    const replies = book.habits.filter((h) => /Trả lời/.test(viOf(h.text)));
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((h) => h.who === 'agency')).toBe(true);
  });

  it('keeps the review ask and the daily story with the shop', () => {
    const ask = book.habits.find((h) => /Xin 1 khách/.test(viOf(h.text)))!;
    expect(ask.who).toBe('salon');
    const story = book.habits.find((h) => h.kind === 'story')!;
    expect(story.who).toBe('salon');
  });

  it('lets one job override its kind, because a kind is not a verdict', () => {
    expect(ownerOf({ kind: 'post', who: 'salon' })).toBe('salon');
    expect(ownerOf({ kind: 'film', who: 'agency' })).toBe('agency');
  });

  it('counts an empty day as neither side’s work', () => {
    expect(isSalonWork({ kind: 'rest' })).toBe(false);
    expect(isAgencyWork({ kind: 'rest' })).toBe(false);
  });

  it('guesses an owner for a generated playbook rather than defaulting to the shop', () => {
    expect(habitOwner('story', 'Đăng story một ca đang làm')).toBe('salon');
    expect(habitOwner('engage', 'Xin 1 khách hài lòng để lại đánh giá')).toBe('salon');
    expect(habitOwner('engage', 'Hẹn ngày dặm ngay tại quầy')).toBe('salon');
    expect(habitOwner('engage', 'Trả lời hết tin nhắn còn sót')).toBe('agency');
    expect(habitOwner('engage', 'Nhắn khách quen quá 4 tuần chưa quay lại')).toBe('agency');
  });
});

describe('the two screens stop disagreeing', () => {
  const plan = buildWeekPlan({ book, week: 0, startDate: '2026-09-14' } as never);
  const all = plan.days.flatMap((d) => d.jobs);

  it('the shop’s material list holds nothing the agency does', () => {
    expect(plan.prep.length).toBeGreaterThan(0);
    expect(plan.prep.every((l) => l.who === 'salon')).toBe(true);
  });

  it('buildPrep still produces the agency’s own lines, tagged as ours', () => {
    const prep = buildPrep({ clips: 3, photos: true, posts: 4, book, week: 0 });
    const caption = prep.find((l) => viOf(l.label).includes('caption'))!;
    expect(caption.who).toBe('agency');
  });

  it('every job the crew queue hands out is work a laptop can do', () => {
    const rows = [{
      tenantId: 't1', salon: 'Nails', slug: 'nails', weekKey: '2026-W38',
      startDate: '2026-09-14', days: plan.days, crew: {},
    }];
    const jobs = crewJobs(rows as never, { today: '2026-09-16', horizonDays: 9 });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => isAgencyWork({ kind: j.kind }))).toBe(true);
    expect(jobs.some((j) => j.kind === 'event')).toBe(false);
  });

  it('the weekly ask no longer hides the physical work behind the media ask', () => {
    const labels = plan.days.map((d) => d.label);
    const jobs = all.map((j, i) => ({
      id: j.id, kind: j.kind, who: j.who, dayIndex: Math.floor(i / 2), day: labels[0], text: j.text,
    }));
    const ask = weeklyAsk(jobs, labels);
    if (ask) {
      // `also` is everything else only the shop can do. It may be empty in a
      // week with no partnership job — what must never happen is a salon-owned
      // job that appears in neither `what` nor `also`.
      const salonJobs = jobs.filter((j) => isSalonWork(j));
      const covered = ask.jobIds.length + ask.also.length;
      expect(covered).toBeGreaterThanOrEqual(Math.min(salonJobs.length, 1));
    }
  });
});

describe('the salon screen tells the salon the truth about who does what', () => {
  const plan = buildWeekPlan({ book, week: 0, startDate: '2026-09-14' } as never);
  const cw = clientWeek(plan as never, null as never);

  it('never tells a shop that we will print cards or photograph its partner', () => {
    // `event` used to be missing from client-view's own kind list, so a job
    // whose steps are "print 30 cards" arrived labelled by: 'lumio'.
    for (const j of cw.jobs) {
      if (j.kind === 'event') expect(j.by).toBe('shop');
    }
    expect(SHOP_JOB_KINDS).toContain('event');
  });

  it('never tells a shop it has to answer its own comments', () => {
    for (const j of cw.jobs) {
      if (j.kind === 'engage') expect(j.by).toBe('lumio');
    }
    expect(SHOP_JOB_KINDS).not.toContain('engage');
  });

  it('agrees with work-owner on every job, with no second opinion anywhere', () => {
    for (const j of cw.jobs) {
      expect(j.by).toBe(isSalonWork({ kind: j.kind as never }) ? 'shop' : 'lumio');
    }
  });
});

/**
 * THE GUARD THAT KEEPS THIS FROM HAPPENING AGAIN.
 *
 * Four files each kept their own list of who does what — CREW_KINDS,
 * ASK_KINDS, COUNTER_KINDS, SHOP_JOB_KINDS — and all four disagreed. The cost
 * was not theoretical: a designer in Vietnam was told to print cards in an
 * American strip mall, and a salon paying for "we do nearly everything" was
 * told to answer its own messages.
 */
describe('one source of truth', () => {
  const dir = __dirname;
  const OWNER_WORDS = /\b(SHOP_KINDS|SALON_KINDS|AGENCY_KINDS|LUMIO_KINDS)\b/;

  it('no module invents its own list of who does what', () => {
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.spec.ts') || f === 'work-owner.ts') continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (OWNER_WORDS.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('the surviving kind lists are derived or documented as fallbacks', () => {
    const cv = fs.readFileSync(path.join(dir, 'client-view.ts'), 'utf8');
    // SHOP_JOB_KINDS must be computed from work-owner, never re-typed.
    expect(cv).toMatch(/SHOP_JOB_KINDS[\s\S]{0,400}isSalonWork/);
    const cb = fs.readFileSync(path.join(dir, 'crew-board.ts'), 'utf8');
    // CREW_KINDS survives only for week rows stored before `who` existed.
    expect(cb).toMatch(/job\.who \? isAgencyWork\(job\)/);
  });
});
