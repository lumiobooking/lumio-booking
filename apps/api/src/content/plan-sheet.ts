/**
 * THE PLAN SHEET — one slot per day, filled by the team before anything is posted.
 *
 * WHERE THIS COMES FROM
 *
 * The agency planned every client in a Google Sheet: a week per band, a day
 * per column, and the same six rows under every day — Pillar, Topic, Detail,
 * Link pic, Air (which networks), Format. Staff filled the sheet first and
 * only then made posts out of it. That order is the point: a month is
 * planned as a whole, in one glance, and each cell becomes a post later.
 *
 * This is that sheet, kept per salon and per month. One entry per calendar
 * day (a salon rarely posts twice in a day; when it does, the second post is
 * scheduled straight from the composer). An entry carries the six columns
 * and, once it has been turned into a scheduled post, the post's id — so
 * the sheet shows "scheduled" where the sheet used to show nothing.
 *
 * STORAGE
 *
 * A Setting row per month, `content_plan_sheet:YYYY-MM`, holding a map of
 * day → entry — the month-brief pattern, no migration. Saves are per day and
 * per field: the client sends only what changed, the server merges it into
 * the stored entry. Two people editing two days of the same month at once
 * can, in theory, cross; the window is one read-modify-write and the cost
 * is one field, which is why this is acceptable and a table would not buy
 * enough to be worth a migration on a live database.
 */

export const PLAN_SHEET_KEY = 'content_plan_sheet';

/** What the post is FOR. The sheet's dropdown, plus two the agency uses in practice. */
export const PILLARS = ['inspiration', 'promotion', 'feedback', 'cta', 'education', 'behind'] as const;
export type Pillar = typeof PILLARS[number];

/** The shape of the asset the designer makes. */
export const FORMATS = ['poster', 'album', 'video', 'story'] as const;
export type Format = typeof FORMATS[number];

/** Where it airs. Same ids as the publishing channels, so an entry maps onto a post 1:1. */
export const AIR = ['facebook', 'instagram', 'tiktok', 'google'] as const;
export type Air = typeof AIR[number];

export interface PlanEntry {
  /** "YYYY-MM-DD", salon-local. */
  day: string;
  pillar: Pillar | '';
  /** The headline the team writes first — "Jelly French Is Having a Moment". */
  topic: string;
  /** The caption body, ready to paste. */
  detail: string;
  /** A link to the picture / clip / Drive folder — a pointer, not an upload. */
  mediaUrl: string;
  air: Air[];
  format: Format | '';
  /** The scheduled post this entry became, once it did. */
  postId: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type PlanSheet = Record<string, PlanEntry>;

export const ENTRY_LIMITS = { topic: 200, detail: 3000, mediaUrl: 800 } as const;

export function isDayKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
}

export function emptyEntry(day: string): PlanEntry {
  return { day, pillar: '', topic: '', detail: '', mediaUrl: '', air: [], format: '', postId: null, updatedAt: null, updatedBy: null };
}

const str = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | '' => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : '');

/** A stored or submitted entry, validated. Never throws; junk reads as empty. */
export function cleanEntry(raw: unknown, day: string): PlanEntry {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const airRaw = Array.isArray(o.air) ? o.air : [];
  const air = Array.from(new Set(airRaw.filter((a): a is Air => typeof a === 'string' && (AIR as readonly string[]).includes(a))));
  return {
    day,
    pillar: oneOf(o.pillar, PILLARS),
    topic: str(o.topic, ENTRY_LIMITS.topic),
    detail: str(o.detail, ENTRY_LIMITS.detail),
    mediaUrl: str(o.mediaUrl, ENTRY_LIMITS.mediaUrl),
    air,
    format: oneOf(o.format, FORMATS),
    postId: typeof o.postId === 'string' && o.postId ? o.postId.slice(0, 64) : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : null,
  };
}

/** True when somebody has typed something — an empty slot is not stored. */
export function entryHasContent(e: PlanEntry): boolean {
  return Boolean(e.pillar || e.topic || e.detail || e.mediaUrl || e.air.length || e.format || e.postId);
}

/** The fields a client may send. Anything else in the body is ignored. */
export const PATCHABLE = ['pillar', 'topic', 'detail', 'mediaUrl', 'air', 'format', 'postId'] as const;

/**
 * Merge what one person changed into what is stored. Only the keys PRESENT
 * in the patch move — a phone that saves the topic must not blank the
 * detail somebody else finished a minute ago. `postId: null` is a real
 * value (the post was deleted; unlink it), so presence is tested with `in`.
 */
export function mergeEntry(current: PlanEntry | null, patch: unknown, day: string, who: string, now: Date): PlanEntry {
  const base = current ?? emptyEntry(day);
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...base };
  for (const k of PATCHABLE) if (k in p) next[k] = p[k];
  return { ...cleanEntry(next, day), updatedAt: now.toISOString(), updatedBy: who };
}

/** A stored month, validated, with empty and misfiled entries dropped. */
export function cleanSheet(raw: unknown, month: string): PlanSheet {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: PlanSheet = {};
  for (const [day, v] of Object.entries(o)) {
    if (!isDayKey(day) || !day.startsWith(month)) continue;
    const e = cleanEntry(v, day);
    if (entryHasContent(e)) out[day] = e;
  }
  return out;
}

/** "YYYY-MM" for a day key. */
export const monthOfDay = (day: string) => day.slice(0, 7);

/** The month keys a run of days touches, in order — two at a month edge, one otherwise. */
export function monthsCovering(from: string, days: number): string[] {
  const [y, m, d] = from.split('-').map(Number);
  const first = monthOfDay(from);
  const lastDate = new Date(Date.UTC(y, m - 1, d + Math.max(0, days - 1)));
  const last = lastDate.toISOString().slice(0, 7);
  if (last === first) return [first];
  const out = [first];
  let [cy, cm] = first.split('-').map(Number);
  while (`${cy}-${String(cm).padStart(2, '0')}` !== last && out.length < 4) {
    cm += 1; if (cm > 12) { cm = 1; cy += 1; }
    out.push(`${cy}-${String(cm).padStart(2, '0')}`);
  }
  return out;
}

/** Keep only the days of a window; the client asked for 35 days, not a month. */
export function windowOf(sheet: PlanSheet, from: string, days: number): PlanSheet {
  const [y, m, d] = from.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const end = start + days * 86_400_000;
  const out: PlanSheet = {};
  for (const [day, e] of Object.entries(sheet)) {
    const [yy, mm, dd] = day.split('-').map(Number);
    const t = Date.UTC(yy, mm - 1, dd);
    if (t >= start && t < end) out[day] = e;
  }
  return out;
}

/**
 * What the SHOP sees of a slot — rebuilt field by field, the client-view
 * rule. The topic, the caption, the pillar, the networks, the format and
 * the post it became: what the shop is going to be asked to approve. Not
 * the media link (a folder in the agency's Drive) and not who typed it.
 */
export function entryForShop(e: PlanEntry): {
  day: string; pillar: Pillar | ''; topic: string; detail: string; air: Air[]; format: Format | ''; postId: string | null; updatedAt: string | null;
} {
  return { day: e.day, pillar: e.pillar, topic: e.topic, detail: e.detail, air: e.air, format: e.format, postId: e.postId, updatedAt: e.updatedAt };
}
