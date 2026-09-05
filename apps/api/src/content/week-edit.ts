import { isBi, type Txt } from './i18n';
import type { DayPlan, Job, JobKind } from './weekly-plan';

/**
 * What a person is allowed to hand back after rewriting a week.
 *
 * WHY THE PLAN IS NOT SIMPLY STORED AS SENT
 *
 * The edited week is a JSON blob that gets written into the plan payload and
 * read back by six other things — the screen, the archive, the nightly
 * drafter, the AI prompts, the bilingual walk. A blob shaped by whatever the
 * browser posted would break all of them at once, and the break would surface
 * a week later in a place with no connection to the edit.
 *
 * So the days that come back are checked against the days that went out. The
 * SKELETON is the server's — seven days, their weekday numbers, their labels —
 * and the editor may only fill it: reword a job, retime it, add one, delete
 * one, move one to another day. A day the plan does not have cannot be
 * invented, and a label cannot be rewritten into something the calendar
 * disagrees with.
 *
 * TEXT TYPED BY A PERSON IS ONE LANGUAGE, HONESTLY
 *
 * Generated phrases carry both languages (see ./i18n). A staff member typing
 * into the editor types one. Rather than machine-translating behind their back
 * — which is how an English-reading client ends up with a confidently wrong
 * sentence nobody wrote — a typed string is stored as a plain string, which
 * both renderings show identically. The screen says so next to the field.
 */

export const JOB_KINDS: JobKind[] = ['film', 'post', 'story', 'offer', 'winback', 'engage', 'rest'];

/** Limits. Generous enough for a real instruction, small enough to bound the row. */
export const MAX_JOB_TEXT = 200;
export const MAX_JOB_WHY = 300;
export const MAX_JOB_WHEN = 40;
/** Per day. A day with more than this is not a plan, it is a list nobody does. */
export const MAX_JOBS_PER_DAY = 12;

function clean(raw: unknown, cap: number): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/**
 * One field, preserving a bilingual value the editor did not touch.
 *
 * The screen sends back what it rendered — one language, because that is what
 * the person read. If the text is unchanged from the side they were shown, the
 * OTHER language must survive: otherwise opening the plan in Vietnamese and
 * pressing save would quietly delete every English phrase in the week.
 */
export function keepOrReplace(next: unknown, before: Txt | undefined, lang: 'vi' | 'en', cap: number): Txt | undefined {
  const typed = clean(next, cap);
  if (!typed) return undefined;
  if (isBi(before)) {
    if (before[lang] === typed) return before; // untouched — keep both sides
    return { ...before, [lang]: typed };       // edited — the other side stands
  }
  return typed;
}

function jobKind(raw: unknown): JobKind {
  const k = String(raw ?? '').trim().toLowerCase() as JobKind;
  return JOB_KINDS.includes(k) ? k : 'post';
}

interface RawJob { kind?: unknown; text?: unknown; why?: unknown; when?: unknown; from?: unknown }

/**
 * One job, rebuilt.
 *
 * `from` is the job's identity in the version that was sent to the browser —
 * "day 3, job 2" — and it is the only way an edit can keep the bilingual
 * phrases of a job that was moved to another day rather than rewritten.
 */
function sanitizeJob(raw: RawJob, lang: 'vi' | 'en', find: (from: unknown) => Job | null): Job | null {
  const before = find(raw?.from);
  const text = keepOrReplace(raw?.text, before?.text, lang, MAX_JOB_TEXT);
  if (!text) return null; // a job with no instruction is not a job
  const why = keepOrReplace(raw?.why, before?.why, lang, MAX_JOB_WHY) ?? '';
  const when = keepOrReplace(raw?.when, before?.when, lang, MAX_JOB_WHEN);
  const job: Job = { kind: jobKind(raw?.kind ?? before?.kind), text, why };
  if (when) job.when = when;
  return job;
}

/**
 * The whole week, rebuilt on the server's own skeleton.
 *
 * `base` is the version the editor was working from. Its weekday numbers and
 * labels are authoritative; everything else can be replaced.
 */
export function sanitizeDays(raw: unknown, base: DayPlan[], lang: 'vi' | 'en' = 'vi'): DayPlan[] {
  const sent = Array.isArray(raw) ? raw : [];
  // Every job the browser was given, addressable by where it was.
  const byAddress = new Map<string, Job>();
  base.forEach((d, di) => (d.jobs ?? []).forEach((j, ji) => byAddress.set(`${di}:${ji}`, j)));
  const find = (from: unknown) => (typeof from === 'string' ? byAddress.get(from) ?? null : null);

  return base.map((day, di) => {
    const incoming = sent[di] as { jobs?: unknown } | undefined;
    // A day the browser did not send back is left exactly as it was, rather
    // than emptied. A truncated request must not delete a Thursday.
    if (!incoming || !Array.isArray(incoming.jobs)) return day;
    const jobs = (incoming.jobs as RawJob[])
      .slice(0, MAX_JOBS_PER_DAY)
      .map((j) => sanitizeJob(j ?? {}, lang, find))
      .filter((j): j is Job => j !== null);
    // An empty day is a real answer — "nothing on Wednesday" — and is stored
    // as the rest marker the renderer already understands, so a blank day and
    // a day off look the same to every reader downstream.
    return { ...day, weekday: day.weekday, label: day.label, jobs: jobs.length ? jobs : restDay(di, base) };
  });
}

/** What an emptied day holds. Reuses the base's own rest job when it had one. */
function restDay(di: number, base: DayPlan[]): Job[] {
  const was = (base[di]?.jobs ?? []).find((j) => j.kind === 'rest');
  return [was ?? { kind: 'rest', text: { vi: 'Nghỉ', en: 'Rest' }, why: '' }];
}
