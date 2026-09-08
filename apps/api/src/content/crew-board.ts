import { viOf, enOf, bi, type Txt } from './i18n';
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

/** The kinds Lumio does with its own hands. Filming and photographing are the shop's. */
export const CREW_KINDS: JobKind[] = ['post', 'story', 'offer', 'winback', 'gbp', 'event'];

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
  post: 'design', story: 'design', offer: 'design', event: 'design',
  gbp: 'content', winback: 'content',
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
}

export interface CrewGroup {
  kind: JobKind;
  label: Txt;
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
export function crewJobs(rows: WeekRowLike[], opts: { today: string; lang?: 'vi' | 'en'; horizonDays?: number }): CrewJob[] {
  const lang = opts.lang ?? 'vi';
  const say = (t: Txt | undefined) => (lang === 'en' ? enOf(t) : viOf(t));
  const horizon = opts.horizonDays ?? 2;
  const todayMs = Date.parse(`${opts.today}T00:00:00Z`);
  const out: CrewJob[] = [];

  for (const row of rows ?? []) {
    const crew = (row.crew ?? {}) as Record<string, CrewHold>;
    (row.days ?? []).forEach((day: DayPlan, dayIndex) => {
      for (const j of day.jobs ?? []) {
        const job = j as Job;
        if (!CREW_KINDS.includes(job.kind) || !job.id) continue;
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
export function groupByKind(jobs: CrewJob[]): CrewGroup[] {
  const by = new Map<JobKind, CrewJob[]>();
  for (const j of jobs) by.set(j.kind, [...(by.get(j.kind) ?? []), j]);
  return [...by.entries()]
    .map(([kind, list]) => ({ kind, label: KIND_LABEL[kind] ?? bi(kind, kind), jobs: sortCrew(list) }))
    .sort((a, b) => b.jobs.length - a.jobs.length);
}

export interface CrewCounts { open: number; mine: number; late: number; done: number }

export function crewCounts(jobs: CrewJob[], me: string | null): CrewCounts {
  const live = jobs.filter((j) => !j.done);
  return {
    open: live.filter((j) => !j.by).length,
    mine: me ? live.filter((j) => j.by === me).length : 0,
    late: live.filter((j) => j.lateDays > 0).length,
    done: jobs.filter((j) => j.done).length,
  };
}
