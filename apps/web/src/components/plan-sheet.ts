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

export type Pillar = 'inspiration' | 'promotion' | 'feedback' | 'cta' | 'education' | 'behind';
export type Format = 'poster' | 'album' | 'video' | 'story';
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
 * The pillar swatches, lifted from the sheet: the colours the team already
 * reads at a glance. Backgrounds are fixed accents (they do not flip with the
 * theme) and each carries its own ink, so a chip is legible in both modes.
 */
export const PILLARS: { id: Pillar; vi: string; en: string; bg: string; ink: string }[] = [
  { id: 'inspiration', vi: 'Cảm hứng', en: 'Inspiration', bg: '#fde68a', ink: '#78350f' },
  { id: 'promotion', vi: 'Khuyến mãi', en: 'Promotion', bg: '#bbf7d0', ink: '#14532d' },
  { id: 'feedback', vi: 'Feedback', en: 'Feedback', bg: '#7c3aed', ink: '#ffffff' },
  { id: 'cta', vi: 'Kêu gọi đặt lịch', en: 'CTA', bg: '#bfdbfe', ink: '#1e3a8a' },
  { id: 'education', vi: 'Kiến thức', en: 'Education', bg: '#c7d2fe', ink: '#312e81' },
  { id: 'behind', vi: 'Hậu trường', en: 'Behind the scenes', bg: '#fbcfe8', ink: '#831843' },
];

export const FORMATS: { id: Format; vi: string; en: string; bg: string; ink: string }[] = [
  { id: 'poster', vi: 'Poster', en: 'Poster', bg: '#1d4ed8', ink: '#ffffff' },
  { id: 'album', vi: 'Album', en: 'Album', bg: '#7dd3fc', ink: '#0c4a6e' },
  { id: 'video', vi: 'Video', en: 'Video', bg: '#bae6fd', ink: '#0c4a6e' },
  { id: 'story', vi: 'Story', en: 'Story', bg: '#fecdd3', ink: '#881337' },
];

export const AIR: { id: Air; short: string; bg: string }[] = [
  { id: 'facebook', short: 'Fb', bg: '#1877f2' },
  { id: 'instagram', short: 'Ins', bg: '#e1306c' },
  { id: 'tiktok', short: 'TikTok', bg: '#111827' },
  { id: 'google', short: 'GG', bg: '#34a853' },
];

export const pillarOf = (id: string) => PILLARS.find((p) => p.id === id) ?? null;
export const formatOf = (id: string) => FORMATS.find((f) => f.id === id) ?? null;

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

/** The month after "YYYY-MM". */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
