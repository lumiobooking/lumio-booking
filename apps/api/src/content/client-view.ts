import { viOf, enOf, type Txt } from './i18n';
import type { DayPlan, Job, JobKind, WeekPlan } from './weekly-plan';

/**
 * What the SALON is allowed to see, as opposed to what the team works from.
 *
 * THE THREAT THIS IS ABOUT, STATED PLAINLY
 *
 * A salon owner hands their login to somebody — a cousin who "does marketing",
 * a consultant, the shop that opens across the road next year. Whatever they
 * see, that person sees. Everything on the team's own screens is method: which
 * hashtag feeds get read every morning, that the filming day is the quietest
 * day on the booking book, that the posting window comes from when that shop's
 * customers actually decide, the five-stage path and its exit conditions. None
 * of that is the salon's data. It is how the agency works, and it is the only
 * thing the agency has that a competitor cannot buy.
 *
 * So the split is not a permission on a menu. It is a SHAPE: the client payload
 * is built here, from scratch, out of the few fields a shop needs to do its
 * part. Nothing is hidden by omission on a screen; the fields never leave the
 * server. A future field added to WeekPlan does not appear on the client side
 * unless somebody adds it here on purpose, which is the property that matters —
 * leaks come from defaults, not from decisions.
 *
 * WHAT A SHOP ACTUALLY NEEDS
 *
 * Two things, and they are physical: get the raw material in front of the
 * camera, and ask happy customers for reviews. Everything else — what gets
 * posted, when, where, and why that day — is the team's job and the team's
 * method. So the client's week is the shop's own jobs, on their day, with no
 * reason attached and no publishing schedule at all.
 */

/** The only job kinds a salon is asked to do with its own hands. */
export const SHOP_JOB_KINDS: JobKind[] = ['film', 'photo', 'engage'];

export interface ClientJob {
  /** Which of the seven days, 0 = today. Enough to plan a shoot around. */
  dayIndex: number;
  /** The weekday name the shop reads. */
  day: Txt;
  kind: JobKind;
  /** The instruction, including what to shoot. No reasoning attached. */
  text: Txt;
}

export interface ClientWeek {
  /** One line: what this week is about. The stage's own words, never its number. */
  focus: Txt;
  jobs: ClientJob[];
  /** What the shop should come home with, from the plan's own prep list. */
  prep: { label: Txt; detail: Txt }[];
}

/**
 * The salon's half of the week.
 *
 * An allow-list of kinds and an allow-list of fields, both spelled out. The
 * tempting version — take the week and delete the sensitive keys — is the
 * version that leaks the next field somebody adds.
 */
export function clientWeek(plan: WeekPlan | null | undefined): ClientWeek | null {
  if (!plan?.days?.length) return null;
  const jobs: ClientJob[] = [];
  plan.days.forEach((d: DayPlan, dayIndex) => {
    for (const j of d.jobs ?? []) {
      if (!SHOP_JOB_KINDS.includes(j.kind)) continue;
      jobs.push({ dayIndex, day: d.label, kind: j.kind, text: (j as Job).text });
    }
  });
  return {
    // The focus line is the one piece of reasoning the shop does get, because
    // without it the week is a list of chores. It says WHAT this week is for,
    // never how the week was decided.
    focus: plan.focus,
    jobs,
    // The prep list is already a summary of the shop's own work — it says how
    // many clips and what to photograph, and nothing about publishing.
    prep: (plan.prep ?? []).map((l) => ({ label: l.label, detail: l.detail })),
  };
}

// ---- suggestions -----------------------------------------------------------

/** A suggestion as the team stores it. `source*` is method, and stays here. */
export interface SuggestionRow {
  id: string;
  title: string;
  note: string | null;
  /** Where the staff member found it. NEVER sent to the salon. */
  sourceUrl: string | null;
  /** Which feed it came off. NEVER sent to the salon. */
  sourceLabel: string | null;
  createdByName: string | null;
  createdAt: Date | string;
  status: string;
  doneAt: Date | string | null;
  media: unknown;
}

/** A suggestion as the salon sees it. */
export interface ClientSuggestion {
  id: string;
  title: string;
  note: string | null;
  createdAt: string;
  /** `used` is collapsed into `done`: the shop sent it either way. */
  status: 'sent' | 'done' | 'skipped';
  media: { url: string; kind: 'image' | 'video' }[];
}

/**
 * The four states a suggestion passes through.
 *
 * `used` is the team's, not the shop's: the files arrived and somebody has
 * turned them into a post. Without it the team's inbox only grows — every card
 * the shop ever answered stays in it, and an inbox that never empties is one
 * nobody reads by the third week.
 *
 * The shop is never shown the difference between `done` and `used`; from its
 * side both mean "sent, Lumio has it".
 */
export type SuggestionState = 'sent' | 'done' | 'skipped' | 'used';

export function suggestionStatus(raw: unknown): SuggestionState {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'done' || s === 'skipped' || s === 'used' ? s : 'sent';
}

/** Files the shop sent back, read defensively out of a JSON column. */
export function mediaOf(raw: unknown): { url: string; kind: 'image' | 'video' }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const url = String((m as { url?: unknown })?.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) return null;
      const kind = String((m as { kind?: unknown })?.kind ?? '') === 'video' ? 'video' : 'image';
      return { url, kind } as const;
    })
    .filter((m): m is { url: string; kind: 'image' | 'video' } => m !== null)
    .slice(0, 12);
}

/**
 * One suggestion, rebuilt for the salon.
 *
 * Rebuilt rather than filtered, for the same reason as the week: a `delete
 * row.sourceUrl` is one forgotten line away from publishing the feed the
 * agency reads every morning. There is no author name either — the shop hears
 * from Lumio, not from whichever employee was on shift, and a name is one more
 * thing a departing staff member takes with them.
 */
export function clientSuggestion(row: SuggestionRow): ClientSuggestion {
  return {
    id: row.id,
    title: row.title,
    note: row.note ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    // A shop that filmed the thing has done its half. Whether the team has got
    // round to editing it is the team's business and not a state the shop
    // should have to interpret.
    status: suggestionStatus(row.status) === 'skipped' ? 'skipped'
      : suggestionStatus(row.status) === 'sent' ? 'sent' : 'done',
    media: mediaOf(row.media),
  };
}

/**
 * Every phrase on the client screen, in the language that screen is in.
 *
 * The team's payload carries both languages (see ./i18n); the salon's does not
 * need to, and a client payload that carries an unused English copy of every
 * Vietnamese sentence is a payload twice the size on a phone.
 */
export function flattenForClient<T>(value: T, lang: 'vi' | 'en'): unknown {
  if (Array.isArray(value)) return value.map((v) => flattenForClient(v, lang));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.vi === 'string' && typeof o.en === 'string' && Object.keys(o).length === 2) {
      return lang === 'en' ? o.en : o.vi;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = flattenForClient(v, lang);
    return out;
  }
  return value;
}

/** The label a shop reads for one of its own jobs. */
export function shopJobLabel(kind: JobKind, vi: boolean): string {
  if (kind === 'film') return vi ? 'Quay' : 'Film';
  if (kind === 'photo') return vi ? 'Chụp ảnh' : 'Photos';
  return vi ? 'Tại quầy' : 'At the counter';
}

/** Used by the tests and by the service, so both agree on what must never leak. */
export const NEVER_TO_CLIENT = [
  'sourceUrl', 'sourceLabel', 'createdByName',
  'why', 'when', 'stage', 'basis', 'report', 'sources', 'daily', 'targets', 'trends',
] as const;

/** Deep search for a forbidden key. The test's teeth. */
export function leaksAnything(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown): string | null => {
    if (!v || typeof v !== 'object') return null;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) { const hit = walk(x); if (hit) return hit; }
      return null;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if ((NEVER_TO_CLIENT as readonly string[]).includes(k)) return k;
      const hit = walk(val);
      if (hit) return hit;
    }
    return null;
  };
  return walk(payload);
}

/** Unused, but kept honest: the words the client screen uses for a status. */
export const CLIENT_STATUS_VI: Record<ClientSuggestion['status'], string> = {
  sent: 'Chờ tiệm làm',
  done: 'Tiệm đã gửi',
  skipped: 'Tiệm bỏ qua',
};

/** Waiting on the TEAM: the shop sent files and nobody has made a post yet. */
export function needsTeam(status: unknown): boolean {
  return suggestionStatus(status) === 'done';
}

export { viOf, enOf };
