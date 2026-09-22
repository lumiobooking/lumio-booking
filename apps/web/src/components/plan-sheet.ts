/**
 * The plan sheet's vocabulary and arithmetic — plain TypeScript, no JSX, so
 * the web test project can load it (see plan-grid.ts for why).
 *
 * The sheet mirrors the Google Sheet the agency planned clients in: a week
 * per band, a day per column, six rows under each day. PlanSheet.tsx draws
 * it; this file knows what the rows mean and how a filled slot becomes a
 * post. Ids match apps/api/src/content/plan-sheet.ts exactly.
 */

import { addDays, daysBetween, mondayIndex } from './plan-grid';

/**
 * A pillar or format id. The built-in ids ('inspiration', 'poster', …) and
 * each salon's own ("c-…") — the lists are the salon's, see PlanTags.
 */
export type Pillar = string;
export type Format = string;
export type Air = 'facebook' | 'instagram' | 'tiktok' | 'google';

export interface PlanEntry {
  day: string;
  pillar: Pillar | '';
  topic: string;
  detail: string;
  mediaUrl: string;
  air: Air[];
  format: Format | '';
  postId: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type PlanPatch = Partial<Pick<PlanEntry, 'pillar' | 'topic' | 'detail' | 'mediaUrl' | 'air' | 'format' | 'postId'>>;

export const emptyEntry = (day: string): PlanEntry => ({ day, pillar: '', topic: '', detail: '', mediaUrl: '', air: [], format: '', postId: null, updatedAt: null, updatedBy: null });

/**
 * Chip colours: a fixed palette, lifted from the agency's sheet. Backgrounds
 * are fixed accents (they do not flip with the theme) and each carries its
 * own ink, so a chip is legible in both modes. Same order as the API's
 * TAG_COLORS — a tag stores an index into it.
 */
export const TAG_COLORS: { bg: string; ink: string }[] = [
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
];

/** One chip as the salon stores it (apps/api/src/content/plan-tags.ts). An empty id is a new chip; the server mints it. */
export interface PlanTag { id: string; vi: string; en: string; color: number; hidden?: boolean }
export interface PlanTags { pillars: PlanTag[]; formats: PlanTag[] }

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

/** A chip ready to draw. */
export interface TagView { id: string; vi: string; en: string; bg: string; ink: string; hidden: boolean }

export const tagViews = (list: PlanTag[]): TagView[] =>
  list.map((t) => {
    const c = TAG_COLORS[t.color] ?? TAG_COLORS[12];
    return { id: t.id, vi: t.vi, en: t.en, bg: c.bg, ink: c.ink, hidden: Boolean(t.hidden) };
  });

/** What the server sent, or the built-in set when it sent nothing usable (an older API). */
export function tagsOr(raw: unknown): PlanTags {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlanTags>;
  const ok = (l: unknown): l is PlanTag[] => Array.isArray(l) && l.length > 0 && l.every((t) => t && typeof t.id === 'string' && typeof t.vi === 'string');
  return { pillars: ok(o.pillars) ? o.pillars : DEFAULT_TAGS.pillars, formats: ok(o.formats) ? o.formats : DEFAULT_TAGS.formats };
}

export const PILLARS: TagView[] = tagViews(DEFAULT_TAGS.pillars);
export const FORMATS: TagView[] = tagViews(DEFAULT_TAGS.formats);

export const AIR: { id: Air; short: string; bg: string }[] = [
  { id: 'facebook', short: 'Fb', bg: '#1877f2' },
  { id: 'instagram', short: 'Ins', bg: '#e1306c' },
  { id: 'tiktok', short: 'TikTok', bg: '#111827' },
  { id: 'google', short: 'GG', bg: '#34a853' },
];

export const pillarOf = (id: string, list: TagView[] = PILLARS) => list.find((p) => p.id === id) ?? null;
export const formatOf = (id: string, list: TagView[] = FORMATS) => list.find((f) => f.id === id) ?? null;

/** True when somebody has typed something into the slot. */
export function entryHasContent(e: PlanEntry | null | undefined): boolean {
  return Boolean(e && (e.pillar || e.topic || e.detail || e.mediaUrl || e.air.length || e.format || e.postId));
}

/** Ready to schedule: it has words, and somewhere to go. */
export function entryReady(e: PlanEntry | null | undefined): boolean {
  return Boolean(e && (e.topic || e.detail) && e.air.length);
}

/**
 * A filled slot becomes a post: the caption is the detail when there is
 * one (the topic is a working title, not a caption), else the topic; the
 * channels are the ones it airs on AND the salon has connected — a slot
 * marked TikTok on a salon without TikTok becomes a Facebook post, not an
 * error at publish time. Nothing is retyped.
 */
export function entryToDraft(
  e: PlanEntry,
  connected: Record<Air, boolean>,
): { message: string; channels: Air[]; at: string; teamNote: string } {
  let channels = e.air.filter((a) => connected[a]);
  if (!channels.length) {
    const first = (['facebook', 'instagram', 'google', 'tiktok'] as Air[]).find((a) => connected[a]);
    channels = first ? [first] : ['facebook'];
  }
  const message = (e.detail.trim() || e.topic.trim());
  const note = [e.topic.trim() ? `Plan: ${e.topic.trim()}` : '', e.mediaUrl.trim() ? `Ảnh/clip: ${e.mediaUrl.trim()}` : ''].filter(Boolean).join(' · ');
  return { message, channels, at: `${e.day}T10:00`, teamNote: note.slice(0, 200) };
}

export interface SheetDay { key: string; past: boolean; today: boolean; /** Inside the month (or window) the sheet is about. */ inWindow: boolean }

/** Five Monday-aligned weeks from a start Monday: the sheet's bands. */
export function sheetWeeks(from: string, todayKey: string, weeks = 5): SheetDay[][] {
  const first = addDays(from, -mondayIndex(from));
  const out: SheetDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: SheetDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(first, w * 7 + i);
      const off = daysBetween(todayKey, key);
      row.push({ key, past: off < 0, today: off === 0, inWindow: off >= 0 && off < 30 });
    }
    out.push(row);
  }
  return out;
}

/** Slots filled / scheduled / of the window — the sheet's one-line summary. */
export function sheetProgress(weeks: SheetDay[][], entries: Record<string, PlanEntry>): { filled: number; scheduled: number; days: number } {
  let filled = 0, scheduled = 0, days = 0;
  for (const row of weeks) for (const d of row) {
    if (!d.inWindow) continue;
    days++;
    const e = entries[d.key];
    if (entryHasContent(e)) filled++;
    if (e?.postId) scheduled++;
  }
  return { filled, scheduled, days };
}

// ---------------------------------------------------------------------------
// An idea becoming a plan slot
// ---------------------------------------------------------------------------

/**
 * The system's suggestion, translated into the sheet's six columns — so a
 * person edits it on the plan first and schedules it later, instead of the
 * old path that dropped the idea straight into the composer. The pillar,
 * format and networks are guesses from the kind of job; every one of them is
 * a chip the person can change in the panel.
 */
export function entryFromIdea(
  job: { kind: string; text: string; why?: string; brief?: { caption?: string; hashtags?: string[]; channel?: string } | null },
): PlanPatch {
  const kind = job.kind;
  const pillar: Pillar =
    kind === 'offer' ? 'promotion'
      : kind === 'winback' ? 'cta'
        : kind === 'engage' || kind === 'gbp' ? 'feedback'
          : kind === 'story' ? 'behind'
            : 'inspiration';
  const format: Format = kind === 'film' ? 'video' : kind === 'photo' ? 'album' : kind === 'story' ? 'story' : 'poster';
  const air: Air[] = kind === 'gbp' ? ['google'] : kind === 'story' ? ['instagram'] : ['facebook', 'instagram'];
  const caption = job.brief?.caption?.trim() ?? '';
  const tags = (job.brief?.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const detail = [caption, tags].filter(Boolean).join('\n\n');
  return { pillar, topic: job.text.trim().slice(0, 200), detail, air, format };
}

/**
 * Lay an idea over what a day already holds: the person's own words win, the
 * idea fills only what is still blank. Sending an idea to a planned day must
 * never erase the plan.
 */
export function mergeIdeaInto(existing: PlanEntry | undefined, idea: PlanPatch): PlanPatch {
  if (!existing || !entryHasContent(existing)) return idea;
  const out: PlanPatch = {};
  if (!existing.pillar && idea.pillar) out.pillar = idea.pillar;
  if (!existing.topic && idea.topic) out.topic = idea.topic;
  if (!existing.detail && idea.detail) out.detail = idea.detail;
  if (!existing.format && idea.format) out.format = idea.format;
  if (!existing.air.length && idea.air?.length) out.air = idea.air;
  return out;
}

/**
 * One month as calendar rows: Monday on or before the 1st to Sunday on or
 * after the last day. Days outside the month are on the grid (so the rows
 * line up) but not "in window"; they draw as blanks.
 */
export function monthWeeks(month: string, todayKey: string): SheetDay[][] {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const start = addDays(first, -mondayIndex(first));
  const rows = Math.ceil((daysBetween(start, last) + 1) / 7);
  const out: SheetDay[][] = [];
  for (let w = 0; w < rows; w++) {
    const row: SheetDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(start, w * 7 + i);
      const off = daysBetween(todayKey, key);
      row.push({ key, past: off < 0, today: off === 0, inWindow: key.startsWith(month) });
    }
    out.push(row);
  }
  return out;
}

/** "Tháng 9 · 2026" / "September 2026". */
export function monthTitle(month: string, vi: boolean): string {
  const [y, m] = month.split('-').map(Number);
  const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return vi ? `Tháng ${m} · ${y}` : `${EN[m - 1]} ${y}`;
}

/**
 * "YYYY-MM" n months away, over the year boundary — December + 1 is next
 * January, not month 13. Mirrors apps/api/src/content/plan-sheet.ts.
 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** The month after "YYYY-MM". */
export const nextMonth = (month: string) => shiftMonth(month, 1);

/**
 * How far a person may wander from the month they are in: a year back, so a
 * client asking "what did you do for us last spring" can be answered, and a
 * quarter forward, which is as far ahead as anyone plans a salon.
 */
export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 3;

/** Months away from today's month — negative is the past. */
export function monthOffset(from: string, to: string): number {
  const [ay, am] = from.split('-').map(Number);
  const [by, bm] = to.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

/** Whether the arrows may step there at all. */
export function monthInRange(today: string, month: string): boolean {
  const off = monthOffset(today.slice(0, 7), month);
  return off >= -MONTHS_BACK && off <= MONTHS_AHEAD;
}
