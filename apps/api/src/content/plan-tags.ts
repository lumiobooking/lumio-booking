/**
 * The pillar and format chips on a salon's month plan — its own list.
 *
 * Six pillars and four formats were hard-coded, and they were a nail salon's:
 * a restaurant has no "Hậu trường" worth a column and badly wants "Món mới".
 * So each salon keeps its own list, starting from the built-in set, and the
 * team edits it from the plan itself.
 *
 * TWO RULES THAT KEEP OLD PLANS READABLE
 *
 * 1. Ids never change. A label can be reworded as often as anyone likes; the
 *    day slots store the id, so every past slot follows the new wording.
 * 2. Nothing is ever deleted — it is HIDDEN. A hidden chip is not offered on
 *    new slots, but August's plan still shows "Món mới" in its own colour
 *    rather than an orphaned id. Delete-for-real would silently blank every
 *    slot that used it.
 *
 * Built-in ids ('inspiration', 'poster', …) stay valid forever; new ones are
 * minted here as "c-" + a random slug, which is what ./plan-sheet accepts.
 */

import { randomBytes } from 'crypto';

export const PLAN_TAGS_KEY = 'plan_tags';

/** Chip colours: a fixed palette, so every chip stays legible in both themes. */
export const TAG_COLORS = [
  { bg: '#fde68a', ink: '#78350f' },
  { bg: '#bbf7d0', ink: '#14532d' },
  { bg: '#7c3aed', ink: '#ffffff' },
  { bg: '#bfdbfe', ink: '#1e3a8a' },
  { bg: '#c7d2fe', ink: '#312e81' },
  { bg: '#fbcfe8', ink: '#831843' },
  { bg: '#1d4ed8', ink: '#ffffff' },
  { bg: '#7dd3fc', ink: '#0c4a6e' },
  { bg: '#bae6fd', ink: '#0c4a6e' },
  { bg: '#fecdd3', ink: '#881337' },
  { bg: '#fed7aa', ink: '#7c2d12' },
  { bg: '#d9f99d', ink: '#365314' },
  { bg: '#e2e8f0', ink: '#1e293b' },
  { bg: '#0f766e', ink: '#ffffff' },
] as const;

export interface PlanTag {
  id: string;
  vi: string;
  en: string;
  /** Index into TAG_COLORS. */
  color: number;
  /** Not offered on new slots; still drawn on the slots that use it. */
  hidden?: boolean;
}

export interface PlanTags {
  pillars: PlanTag[];
  formats: PlanTag[];
}

export const DEFAULT_TAGS: PlanTags = {
  pillars: [
    { id: 'inspiration', vi: 'Cảm hứng', en: 'Inspiration', color: 0 },
    { id: 'promotion', vi: 'Khuyến mãi', en: 'Promotion', color: 1 },
    { id: 'feedback', vi: 'Feedback', en: 'Feedback', color: 2 },
    { id: 'cta', vi: 'Kêu gọi đặt lịch', en: 'CTA', color: 3 },
    { id: 'education', vi: 'Kiến thức', en: 'Education', color: 4 },
    { id: 'behind', vi: 'Hậu trường', en: 'Behind the scenes', color: 5 },
  ],
  formats: [
    { id: 'poster', vi: 'Poster', en: 'Poster', color: 6 },
    { id: 'album', vi: 'Album', en: 'Album', color: 7 },
    { id: 'video', vi: 'Video', en: 'Video', color: 8 },
    { id: 'story', vi: 'Story', en: 'Story', color: 9 },
  ],
};

/** How many chips a list may hold, hidden ones included. */
export const MAX_TAGS = 24;
export const MAX_LABEL = 30;

const BUILT_IN = new Set([...DEFAULT_TAGS.pillars, ...DEFAULT_TAGS.formats].map((t) => t.id));
const isCustomId = (s: string) => /^c-[a-z0-9]{4,24}$/.test(s);

export function newTagId(): string {
  return 'c-' + randomBytes(5).toString('hex');
}

const label = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);

/**
 * One list, cleaned. `previous` is what is stored now: an id that was there
 * and is missing from the submission is kept as hidden, never dropped, so a
 * client that forgets a row cannot orphan every slot that used it.
 */
function cleanList(raw: unknown, previous: PlanTag[], builtIn: PlanTag[]): PlanTag[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: PlanTag[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    let id = typeof o.id === 'string' ? o.id : '';
    // A row with no id is a new chip; a row with an id we do not recognise
    // is refused rather than trusted, so an id cannot be forged into place.
    if (!id) id = newTagId();
    else if (!BUILT_IN.has(id) && !isCustomId(id)) continue;
    if (seen.has(id)) continue;
    const vi = label(o.vi) || label(o.en);
    if (!vi) continue;
    const en = label(o.en) || vi;
    const color = Number.isInteger(o.color) && (o.color as number) >= 0 && (o.color as number) < TAG_COLORS.length ? (o.color as number) : out.length % TAG_COLORS.length;
    seen.add(id);
    out.push({ id, vi, en, color, ...(o.hidden === true ? { hidden: true } : {}) });
    if (out.length >= MAX_TAGS) break;
  }
  // Keep what was there. A built-in or previous chip missing from the
  // submission survives, hidden, so its slots still read.
  for (const t of [...previous, ...builtIn]) {
    if (seen.has(t.id) || out.length >= MAX_TAGS) continue;
    seen.add(t.id);
    out.push({ ...t, hidden: true });
  }
  return out;
}

/** What is stored, read safely. Anything unreadable is the built-in set. */
export function readTags(stored: unknown): PlanTags {
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const pillars = Array.isArray(o.pillars) && o.pillars.length ? cleanList(o.pillars, [], DEFAULT_TAGS.pillars) : DEFAULT_TAGS.pillars;
  const formats = Array.isArray(o.formats) && o.formats.length ? cleanList(o.formats, [], DEFAULT_TAGS.formats) : DEFAULT_TAGS.formats;
  return { pillars, formats };
}

/** A submission, cleaned against what is stored now. */
export function cleanTags(raw: unknown, current: PlanTags): PlanTags {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pillars: cleanList(o.pillars ?? current.pillars, current.pillars, DEFAULT_TAGS.pillars),
    formats: cleanList(o.formats ?? current.formats, current.formats, DEFAULT_TAGS.formats),
  };
}
