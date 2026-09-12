import { viOf, enOf, bi, type Txt } from './i18n';
import { isAgencyWork, ownerOf } from './work-owner';
import type { DayPlan, Job, JobKind } from './weekly-plan';

/**
 * Thirty salons' worth of Lumio's own work, as one queue two people can run.
 *
 * THE ARITHMETIC THAT FORCES THE DESIGN
 *
 * A designer and a writer covering thirty salons face about five Lumio jobs
 * per salon per week: call it a hundred and fifty jobs, or twelve to fifteen
 * each per working day. At that volume the expensive thing is not the work,
 * it is the SWITCHING. Opening a salon, reading its plan, remembering what
 * its brand looks like, and closing it again — thirty times a day — costs
 * more hours than the jobs do. So the queue is grouped by KIND, not by salon:
 * twenty-five photo sets in one sitting is one warm-up and twenty-five
 * exports, and the salon becomes a label on a row rather than a place you
 * travel to.
 *
 * WHAT MAKES A HANDOVER POSSIBLE
 *
 * Every job carries its own state — free, somebody's, done — with the name
 * and the hour attached. Nothing lives in a person's head or a chat message,
 * so a colleague who is off is not a gap: their held jobs are visible, aged,
 * and can be taken back by anyone. That is the whole mechanism, deliberately;
 * a second layer of stages and handoffs would double the bookkeeping for two
 * people who mostly sit beside each other.
 *
 * WHAT IS NOT IN THE QUEUE, AND WHY THAT IS THE POINT
 *
 * A job whose material has not arrived is not work — it is a phone call. Those
 * are separated into their own lane with the shop's name and how long it has
 * been waiting, because "chase the salon" is the task that gets forgotten and
 * then explains, three days later, why nothing went out.
 */

/**
 * WHAT REACHES THIS QUEUE — now decided per job, not per kind.
 *
 * The list below was the whole rule, and it was wrong twice over:
 *   - `event` was on it. Its steps are "pick a partner within 1km", "print 30
 *     cards", "photograph both owners". A designer in Vietnam opened the queue
 *     and was told to print cards in an American strip mall.
 *   - `engage` was NOT on it, because weekly-ask filed replying to comments and
 *     messages as a habit of the shop's counter. It is desk work, it is ours,
 *     and being on neither list meant nobody did it at all.
 *
 * Ownership now lives in ./work-owner, on the job. This constant survives only
 * as the fallback for week rows written before jobs carried an owner — a stored
 * plan from last month must not silently change shape.
 */
export const CREW_KINDS: JobKind[] = ['post', 'story', 'offer', 'winback', 'gbp', 'engage'];

export type CrewRole = 'design' | 'content';

/**
 * Which pair of hands a job mostly needs.
 *
 * A hint, not a wall: anything visual is the long pole on a post, and anything
 * that is only words belongs to the writer. Both people can pick up either —
 * the whole point of one shared queue — so a wrong guess here costs a filter
 * click, not a blocked job.
 */
const ROLE: Partial<Record<JobKind, CrewRole>> = {
  post: 'design', story: 'design', offer: 'design',
  gbp: 'content', winback: 'content', engage: 'content',
};

export const KIND_LABEL: Partial<Record<JobKind, Txt>> = {
  post: bi('Đăng bài', 'Posts'),
  story: bi('Story', 'Stories'),
  offer: bi('Bài ưu đãi', 'Offer posts'),
  winback: bi('Nhắn khách cũ', 'Win-back messages'),
  gbp: bi('Hồ sơ Google', 'Google profile'),
  event: bi('Sự kiện · hợp tác', 'Events & partnerships'),
};

export interface CrewHold { by?: unknown; at?: unknown; done?: unknown }

/**
 * HAS THE RAW MATERIAL ARRIVED?
 *
 * The header of this file has promised this lane since the day it was written:
 * "A job whose material has not arrived is not work — it is a phone call."
 * It was never built. `CrewJob` knew who held a job and how late it was and
 * had no idea whether the clip it is made from exists, so a designer opened
 * the queue, picked up "Đăng clip — Dip Powder", and found nothing to edit.
 *
 * The signal is the shop's own upload, not the posting queue. `auto-ticks`
 * reads the queue and can therefore only say whether something was PUBLISHED —
 * useless for the question asked at 9am, which is which salons owe us footage.
 */
export type MaterialState =
  /** Something arrived from the shop for this week. */
  | 'ready'
  /** This job needs footage or photos and none has come in. A phone call. */
  | 'waiting'
  /** Words only — a win-back message, a reply. Nothing to wait for. */
  | 'not-needed';

/**
 * The kinds whose first step is "pick the clip" or "pick 4–6 photos".
 *
 * `gbp` is deliberately absent: its photos come out of the bank we already
 * hold, so it is work even in a week the shop sends nothing — which is exactly
 * the property that makes it worth having in a remote agency's queue.
 */
export const NEEDS_MEDIA: JobKind[] = ['post', 'story', 'offer'];

export interface CrewJob {
  tenantId: string;
  salon: string;
  slug: string;
  weekKey: string;
  jobId: string;
  kind: JobKind;
  role: CrewRole;
  /** The instruction, in the team's language. */
  text: string;
  /** Shot list / caption steps, so a person can start without opening the salon. */
  steps: string[];
  /** 'YYYY-MM-DD' the plan puts it on. */
  due: string;
  /** Days past due. 0 = today, negative = still ahead. */
  lateDays: number;
  /** Who holds it, and since when. */
  by: string | null;
  heldAt: string | null;
  done: boolean;
  /** Whether the raw material for it has arrived. See MaterialState. */
  material: MaterialState;
  /**
   * Days since this week's material was asked for, when it still has not come.
   * Null unless waiting. This is the number that turns "chase the salon" from
   * a thing somebody remembers into a thing somebody can see.
   */
  waitingDays: number | null;
}

export interface CrewGroup {
  kind: JobKind;
  /**
   * Already in ONE language, like every other field that crosses to the
   * browser. The first version handed the screen a `{vi, en}` pair here while
   * flattening the job text beside it, and React refused to render the object
   * — the whole page died on a heading. Everything leaving this module is a
   * string, without exception, so the mistake cannot be made a second time.
   */
  label: string;
  jobs: CrewJob[];
}

export interface WeekRowLike {
  tenantId: string;
  weekKey: string;
  /** Monday of that week, 'YYYY-MM-DD'. */
  startDate: string;
  salon: string;
  slug: string;
  days: DayPlan[];
  crew: Record<string, CrewHold> | null;
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The date a job on day N of a week beginning `startDate` falls on. */
export function jobDate(startDate: string, dayIndex: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  return ymd(new Date(d.getTime() + Math.max(0, dayIndex) * DAY));
}

const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/**
 * Every Lumio job across every salon, flattened.
 *
 * `horizonDays` is how far AHEAD to look. Two is the useful default: today's
 * work plus tomorrow's, so a quiet afternoon can be spent pulling work
 * forward rather than inventing some. Anything further out is noise on a
 * screen whose whole job is to answer "what now".
 */
export function crewJobs(rows: WeekRowLike[], opts: {
  today: string;
  lang?: 'vi' | 'en';
  horizonDays?: number;
  /**
   * The most recent thing each salon has SENT US, as 'YYYY-MM-DD', keyed by
   * tenantId. Absent or null means nothing has ever arrived.
   *
   * Taken from the shop's own uploads — the suggestion rows it opens and
   * closes in one move when it presses "Đã quay xong". Passing it is optional
   * so an older caller keeps working: with no map, nothing is marked waiting
   * and the board behaves exactly as it did.
   */
  lastMediaByTenant?: Record<string, string | null | undefined>;
}): CrewJob[] {
  const lang = opts.lang ?? 'vi';
  const say = (t: Txt | undefined) => (lang === 'en' ? enOf(t) : viOf(t));
  const horizon = opts.horizonDays ?? 2;
  const todayMs = Date.parse(`${opts.today}T00:00:00Z`);
  const out: CrewJob[] = [];

  for (const row of rows ?? []) {
    const crew = (row.crew ?? {}) as Record<string, CrewHold>;
    const lastMedia = opts.lastMediaByTenant?.[row.tenantId] ?? null;
    (row.days ?? []).forEach((day: DayPlan, dayIndex) => {
      for (const j of day.jobs ?? []) {
        const job = j as Job;
        // The job's own owner decides. Rows stored before `who` existed fall
        // back to the kind list, so an old week keeps the queue it had.
        const mine = job.who ? isAgencyWork(job) : CREW_KINDS.includes(job.kind);
        if (!mine || !job.id) continue;
        // "Arrived" means arrived for THIS week. A clip sent three weeks ago is
        // not material for Tuesday's post, and treating it as such is how the
        // lane would have quietly stopped meaning anything.
        // `fromBank` wins over the kind: a review card is a `post` and needs
        // no footage at all. See no-media-content.ts.
        const material: MaterialState = job.fromBank || !NEEDS_MEDIA.includes(job.kind)
          ? 'not-needed'
          : (opts.lastMediaByTenant === undefined
            ? 'ready'
            : (lastMedia && lastMedia >= row.startDate ? 'ready' : 'waiting'));
        const due = jobDate(row.startDate, dayIndex);
        const lateDays = Math.round((todayMs - Date.parse(`${due}T00:00:00Z`)) / DAY);
        // Ahead of the horizon: real work, but not today's question.
        if (lateDays < -horizon) continue;
        const hold = crew[job.id] ?? {};
        out.push({
          tenantId: row.tenantId,
          salon: row.salon,
          slug: row.slug,
          weekKey: row.weekKey,
          jobId: job.id,
          kind: job.kind,
          role: ROLE[job.kind] ?? 'content',
          text: say(job.text),
          steps: (job.brief?.steps ?? []).map((s) => say(s)).filter(Boolean).slice(0, 12),
          due,
          lateDays,
          by: str(hold.by),
          heldAt: str(hold.at),
          done: hold.done === true,
          material,
          waitingDays: material === 'waiting'
            ? Math.max(0, Math.round((todayMs - Date.parse(`${row.startDate}T00:00:00Z`)) / DAY))
            : null,
        });
      }
    });
  }
  return out;
}

/**
 * The queue, in the order a person should work it.
 *
 * Late first, then today, then tomorrow; and inside the same day, the jobs
 * nobody holds before the ones somebody does — a held job already has an
 * owner and does not need a second person's attention.
 */
export function sortCrew(jobs: CrewJob[]): CrewJob[] {
  return [...jobs].sort((a, b) => {
    if (a.lateDays !== b.lateDays) return b.lateDays - a.lateDays;
    if (!!a.by !== !!b.by) return a.by ? 1 : -1;
    return a.salon.localeCompare(b.salon);
  });
}

/** Grouped by kind, biggest batch first — the batch IS the saving. */
export function groupByKind(jobs: CrewJob[], lang: 'vi' | 'en' = 'vi'): CrewGroup[] {
  const say = (t: Txt) => (lang === 'en' ? enOf(t) : viOf(t));
  const by = new Map<JobKind, CrewJob[]>();
  for (const j of jobs) by.set(j.kind, [...(by.get(j.kind) ?? []), j]);
  return [...by.entries()]
    .map(([kind, list]) => ({ kind, label: say(KIND_LABEL[kind] ?? bi(kind, kind)), jobs: sortCrew(list) }))
    .sort((a, b) => b.jobs.length - a.jobs.length);
}

/**
 * THE LANE THIS FILE PROMISED ON DAY ONE.
 *
 * Work and phone calls are two different jobs and belong in two different
 * places. Mixed together, the designer opens "Đăng clip — Dip Powder", finds
 * no clip, puts it back, and three days later somebody asks why nothing went
 * out. Separated, the morning has a shape: these I can do now, these salons I
 * have to chase, and the second list is sorted by how long they have been
 * sitting there.
 */
export interface CrewSplit {
  /** Work that can actually be started right now. */
  ready: CrewJob[];
  /** Jobs that are a phone call, not work. Longest wait first. */
  blocked: CrewJob[];
  /** One line per salon being chased, so twelve jobs are not twelve calls. */
  chase: { tenantId: string; salon: string; slug: string; jobs: number; waitingDays: number }[];
}

export function splitCrew(jobs: CrewJob[]): CrewSplit {
  const live = jobs.filter((j) => !j.done);
  const blocked = live.filter((j) => j.material === 'waiting');
  const ready = sortCrew(live.filter((j) => j.material !== 'waiting'));

  // One salon, one call — however many jobs of theirs are stuck behind it.
  const bySalon = new Map<string, { tenantId: string; salon: string; slug: string; jobs: number; waitingDays: number }>();
  for (const j of blocked) {
    const cur = bySalon.get(j.tenantId);
    bySalon.set(j.tenantId, {
      tenantId: j.tenantId,
      salon: j.salon,
      slug: j.slug,
      jobs: (cur?.jobs ?? 0) + 1,
      waitingDays: Math.max(cur?.waitingDays ?? 0, j.waitingDays ?? 0),
    });
  }
  return {
    ready,
    blocked: [...blocked].sort((a, b) => (b.waitingDays ?? 0) - (a.waitingDays ?? 0) || a.salon.localeCompare(b.salon)),
    chase: [...bySalon.values()].sort((a, b) => b.waitingDays - a.waitingDays || b.jobs - a.jobs),
  };
}

export interface CrewCounts { open: number; mine: number; late: number; done: number; waiting: number }

export function crewCounts(jobs: CrewJob[], me: string | null): CrewCounts {
  const live = jobs.filter((j) => !j.done);
  // `open` counts work somebody can pick up. A job with no clip behind it is
  // not open work — counting it as such is how a queue reads "14 việc" on a
  // morning when four of them are actually four phone calls.
  const startable = live.filter((j) => j.material !== 'waiting');
  return {
    open: startable.filter((j) => !j.by).length,
    mine: me ? live.filter((j) => j.by === me).length : 0,
    late: startable.filter((j) => j.lateDays > 0).length,
    done: jobs.filter((j) => j.done).length,
    waiting: live.filter((j) => j.material === 'waiting').length,
  };
}
