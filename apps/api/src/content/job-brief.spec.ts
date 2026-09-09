import { buildWeekPlan } from './weekly-plan';
import { sanitizeDays } from './week-edit';
import { attachBriefs, jobId, briefFor } from './job-brief';
import { parseOffer, offerHeadline, customOfferJob, DEFAULT_OFFER } from './week-offer';
import { clientWeek, leaksAnything } from './client-view';
import { viOf, enOf } from './i18n';
import type { SlotLoad, OfferAdvice } from './revenue-signals';

const load = (weekday: number, block: SlotLoad['block'], fillIndex: number): SlotLoad => ({
  weekday, block, minutes: fillIndex * 10, revenueCents: fillIndex * 1000, fillIndex,
  label: { vi: `${['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'][weekday]} buổi sáng`, en: `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday]} morning` } as never,
});
const BOOK: SlotLoad[] = [load(6, 'morning', 15), load(1, 'morning', 30), load(3, 'afternoon', 60), load(5, 'morning', 92), load(6, 'afternoon', 100)];
const FILL: OfferAdvice = { kind: 'fill-slot', headline: 'x', detail: '', discountPct: 12, protect: [], basis: '' };

const plan = (over: Partial<Parameters<typeof buildWeekPlan>[0]> = {}) =>
  buildWeekPlan({ today: new Date('2026-09-06T12:00:00Z'), todayWeekday: 0, industry: 'SALON', loads: BOOK, advice: FILL, salonName: 'Vina Nails', city: 'Austin, TX', ...over });
const real = (p: ReturnType<typeof buildWeekPlan>) => p.days.flatMap((d) => d.jobs).filter((j) => j.kind !== 'rest');

describe('every job carries a working sheet', () => {
  it('each non-rest job has an id and steps somebody can tick', () => {
    for (const j of real(plan())) {
      expect(j.id).toMatch(/^[a-z0-9]{7,}(-\d+)?$/);
      expect(j.brief?.steps.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it('ids are unique within the week and stable across regenerations', () => {
    const a = real(plan()).map((j) => j.id);
    const b = real(plan()).map((j) => j.id);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toEqual(b);
  });

  it('posts get a caption that names the shop, tags that name the city', () => {
    const post = real(plan()).find((j) => j.kind === 'post')!;
    expect(viOf(post.brief!.caption!)).toContain('Vina Nails');
    expect(enOf(post.brief!.caption!)).toContain('Vina Nails');
    expect(post.brief!.hashtags).toContain('austinnails');
    expect(viOf(post.brief!.channel!)).toMatch(/Instagram/);
  });

  it('the offer sheet quotes the same number as the offer line', () => {
    const offer = real(plan()).find((j) => j.kind === 'offer')!;
    expect(viOf(offer.text)).toContain('12%');
    expect(viOf(offer.brief!.caption!)).toContain('12%');
    expect(enOf(offer.brief!.caption!)).toContain('12%');
  });

  it('a rest day carries nothing', () => {
    const rest = plan().days.flatMap((d) => d.jobs).find((j) => j.kind === 'rest');
    expect(rest?.brief).toBeUndefined();
    expect(rest?.id).toBeUndefined();
  });

  it('jobId changes when the instruction changes, not when the reason does', () => {
    const a = jobId({ kind: 'post', text: { vi: 'Đăng clip 1', en: 'Post clip 1' } });
    expect(jobId({ kind: 'post', text: { vi: 'Đăng clip 1', en: 'Post clip 1 (edited)' } })).toBe(a);
    expect(jobId({ kind: 'post', text: { vi: 'Đăng clip 2', en: 'Post clip 1' } })).not.toBe(a);
    expect(jobId({ kind: 'film', text: { vi: 'Đăng clip 1', en: 'Post clip 1' } })).not.toBe(a);
  });

  it('attachBriefs never overwrites a sheet a person already edited', () => {
    const days = [{ jobs: [{ kind: 'post' as const, text: 'x', why: '', brief: { steps: ['mine'] } }] }];
    expect(attachBriefs(days, {})[0].jobs[0].brief?.steps).toEqual(['mine']);
  });
});

describe('the offer form outranks the book', () => {
  const custom = parseOffer({ mode: 'custom', kind: 'percent', value: 15, services: 'Gel manicure', days: [2, 3], slot: 'morning', expires: '2026-09-12', terms: 'Khách mới' });

  it('parses only what the form allows', () => {
    expect(custom.value).toBe(15);
    expect(custom.days).toEqual([2, 3]);
    expect(parseOffer({ mode: 'weird', value: 500, days: [9, 'x', 4], slot: 'night', expires: 'tomorrow' }))
      .toMatchObject({ mode: 'auto', value: 90, days: [4], slot: 'all', expires: '' });
    expect(parseOffer(null)).toMatchObject({ mode: 'auto' });
  });

  it('a custom offer replaces the proposal — same number everywhere', () => {
    const p = plan({ offer: custom });
    const offers = real(p).filter((j) => j.kind === 'offer');
    expect(offers).toHaveLength(1);
    expect(viOf(offers[0].text)).toContain('15%');
    expect(viOf(offers[0].text)).not.toContain('12%');
    expect(viOf(offers[0].brief!.caption!)).toContain('15%');
    expect(viOf(offers[0].brief!.caption!)).toContain('Gel manicure');
    expect(viOf(offers[0].brief!.caption!)).toContain('2026-09-12');
    expect(enOf(offers[0].text)).toMatch(/Tuesday, Wednesday morning ONLY/);
    // published two days before the first valid day (Tue → Sun) — and Sunday
    // is this week's reserved rest day, so the plan's own rule moves it to Saturday
    expect(p.days.find((d) => d.jobs.some((j) => j.kind === 'offer'))!.weekday).toBe(6);
  });

  it('off means no offer, and the plan says who switched it off', () => {
    const p = plan({ offer: { ...DEFAULT_OFFER, mode: 'off' } });
    expect(real(p).some((j) => j.kind === 'offer')).toBe(false);
    expect(real(p).some((j) => /không chạy ưu đãi/i.test(viOf(j.text)))).toBe(true);
    // and the countdown story goes with it
    expect(real(p).some((j) => /đếm ngược/i.test(viOf(j.text)))).toBe(false);
  });

  it('auto keeps the system proposal', () => {
    const p = plan({ offer: { ...DEFAULT_OFFER, mode: 'auto' } });
    expect(viOf(real(p).find((j) => j.kind === 'offer')!.text)).toContain('12%');
  });

  it('formats the dong the way the dong is written', () => {
    const o = parseOffer({ mode: 'custom', kind: 'amount', value: 50000 });
    expect(viOf(offerHeadline(o, '₫'))).toContain('50.000₫');
    expect(viOf(offerHeadline(parseOffer({ mode: 'custom', kind: 'amount', value: 10 }), '$'))).toContain('$10');
    expect(viOf(customOfferJob(parseOffer({ mode: 'custom', kind: 'gift', gift: 'vẽ 2 ngón' }), {}).text)).toContain('tặng vẽ 2 ngón');
  });
});

describe('editing keeps the sheet honest', () => {
  const base = plan().days;

  it('an untouched job keeps its id and its sheet through a save', () => {
    const sent = base.map((d, di) => ({ jobs: d.jobs.filter((j) => j.kind !== 'rest').map((j, ji) => ({ ...j, text: viOf(j.text), why: viOf(j.why), from: `${di}:${ji}` })) }));
    const out = sanitizeDays(sent, base, 'vi');
    const before = real({ days: base } as never);
    const after = out.flatMap((d) => d.jobs).filter((j) => j.kind !== 'rest');
    expect(after.map((j) => j.id)).toEqual(before.map((j) => j.id));
    expect(after[0].brief).toEqual(before[0].brief);
  });

  it('a reworded instruction is a new job with a fresh sheet', () => {
    const post = base.findIndex((d) => d.jobs.some((j) => j.kind === 'post'));
    const ji = base[post].jobs.findIndex((j) => j.kind === 'post');
    const sent = base.map((d, di) => ({ jobs: d.jobs.filter((j) => j.kind !== 'rest').map((j, k) => ({ ...j, text: di === post && k === ji ? 'Đăng clip 9 — Mẫu mới' : viOf(j.text), why: viOf(j.why), from: `${di}:${k}` })) }));
    const out = sanitizeDays(sent, base, 'vi', { salonName: 'Vina Nails' });
    const job = out[post].jobs[ji];
    expect(job.id).not.toBe(base[post].jobs[ji].id);
    expect(viOf(job.brief!.caption!)).toContain('Mẫu mới');
  });

  it('a step typed by a person replaces that step and keeps the others bilingual', () => {
    const di = base.findIndex((d) => d.jobs.some((j) => j.kind === 'film'));
    const ji = base[di].jobs.findIndex((j) => j.kind === 'film');
    const steps = base[di].jobs[ji].brief!.steps.map(viOf);
    steps[1] = 'Quay bằng máy ảnh của tiệm';
    const sent = base.map((d, k) => ({ jobs: d.jobs.filter((j) => j.kind !== 'rest').map((j, n) => ({
      text: viOf(j.text), why: viOf(j.why), from: `${k}:${n}`, brief: k === di && n === ji ? { steps } : undefined,
    })) }));
    const out = sanitizeDays(sent, base, 'vi');
    const b = out[di].jobs[ji].brief!;
    expect(viOf(b.steps[1])).toBe('Quay bằng máy ảnh của tiệm');
    // the English side of the edited step stands; the untouched step keeps both
    expect(enOf(b.steps[1])).toBe(enOf(base[di].jobs[ji].brief!.steps[1]));
    expect(b.steps[0]).toEqual(base[di].jobs[ji].brief!.steps[0]);
    expect(b.channel).toEqual(base[di].jobs[ji].brief!.channel);
  });

  it('hashtags are cleaned, capped and never keep the hash', () => {
    const di = base.findIndex((d) => d.jobs.some((j) => j.kind === 'post'));
    const ji = base[di].jobs.findIndex((j) => j.kind === 'post');
    const sent = base.map((d, k) => ({ jobs: d.jobs.filter((j) => j.kind !== 'rest').map((j, n) => ({
      text: viOf(j.text), from: `${k}:${n}`, brief: k === di && n === ji ? { hashtags: ['#Nails', 'nail art!', '', 'nails', ...Array(30).fill('t')] } : undefined,
    })) }));
    expect(sanitizeDays(sent, base, 'vi')[di].jobs[ji].brief!.hashtags).toEqual(['nails', 'nailart', 't']);
  });
});

describe('what the shop sees of the sheet', () => {
  it('gets the steps of every job, never the caption, tags or channel', () => {
    // The whole week travels now (the shop asked to work on the plan), with
    // each job's steps — but the caption, the tags and the channel are the
    // team's publishing work and stay on the sheet. The job id is deliberate:
    // it is what a tick and an edit point at, and it is a hash of the text.
    const cw = clientWeek(plan())!;
    expect(cw.jobs.length).toBeGreaterThan(0);
    for (const j of cw.jobs) expect(j.steps.length).toBeGreaterThanOrEqual(3);
    const s = JSON.stringify(cw.jobs);
    expect(s).not.toMatch(/"hashtags"|"caption"|"channel"|austinnails|"brief"|"why"|"when"/);
    expect(leaksAnything(cw)).toBeNull();
  });

  it('briefFor has nothing to say about rest', () => {
    expect(briefFor({ kind: 'rest', text: 'x', why: '' }, {})).toBeNull();
  });
});

describe('the template caption meets the house standard', () => {
  // The standard is only worth stating if the templates pass it themselves.
  const { captionIssues } = require('./caption-style');
  const { buildWeekPlan } = require('./weekly-plan');
  const { enOf, viOf } = require('./i18n');

  const week = buildWeekPlan({
    today: new Date('2026-09-09T12:00:00Z'), todayWeekday: 3, industry: 'SALON',
    salonName: 'Lux Nail Spa', city: 'Kerrville, TX',
    topics: {
      mostBooked: { name: 'Dip Powder', count: 41 },
      bestYield: { name: 'Gel Polish Change', minutes: 20, perHourCents: 7500 },
      question: { text: 'Does dip powder ruin your natural nails?', times: 7 },
    },
  });
  const posts = week.days.flatMap((d: { jobs: { kind: string; brief?: { caption?: unknown; hashtags?: string[] } }[] }) => d.jobs)
    .filter((j: { kind: string }) => j.kind === 'post');

  it('passes captionIssues in both languages, with tags', () => {
    expect(posts.length).toBeGreaterThan(0);
    for (const j of posts) {
      const tagLine = `\n\n${(j.brief?.hashtags ?? []).map((t: string) => `#${t}`).join(' ')}`;
      expect(captionIssues(enOf(j.brief!.caption) + tagLine)).toEqual([]);
      expect(captionIssues(viOf(j.brief!.caption) + tagLine)).toEqual([]);
    }
  });

  it('puts the shop\'s own number in the proof line, and only that number', () => {
    const all = posts.map((j: { brief?: { caption?: unknown } }) => enOf(j.brief!.caption)).join('\n---\n');
    expect(all).toMatch(/41 bookings this month/);
    expect(all).toMatch(/20 minutes from sitting down/);
    expect(all).not.toMatch(/40 minutes of handwork/); // the old invented figure
  });

  it('answers the customer\'s question in their words, on the week that carries that slot', () => {
    const w2 = buildWeekPlan({
      today: new Date('2026-09-16T12:00:00Z'), todayWeekday: 3, industry: 'SALON', week: 1,
      salonName: 'Lux Nail Spa', city: 'Kerrville, TX',
      topics: { question: { text: 'Does dip powder ruin your natural nails?', times: 7 } },
    });
    const q = w2.days.flatMap((d: { jobs: { kind: string; text: unknown; brief?: { caption?: unknown } }[] }) => d.jobs)
      .find((j: { kind: string; text: unknown }) => j.kind === 'post' && enOf(j.text).includes('ruin'));
    expect(q).toBeTruthy();
    expect(enOf(q!.brief!.caption)).toMatch(/^Does dip powder ruin your natural nails\?\n7 customers have asked us this/);
    expect(captionIssues(enOf(q!.brief!.caption) + '\n\n#a #b #c #d #e')).toEqual([]);
  });

  it('opens with the subject as a claim, not the "— most booked" footnote', () => {
    const dip = posts.find((j: { text: unknown }) => enOf(j.text).includes('Dip Powder'));
    expect(enOf(dip!.brief!.caption)).toMatch(/^Dip Powder\.\n/);
  });

  it('keeps the tags to the standard: city first, eight at most', () => {
    for (const j of posts) {
      const tags = j.brief?.hashtags ?? [];
      expect(tags.length).toBeLessThanOrEqual(8);
      expect(tags.length).toBeGreaterThanOrEqual(5);
      expect(tags[0]).toBe('kerrvillenails');
    }
  });
});
