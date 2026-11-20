/**
 * rt229 — "Mục tin nhắn kéo về chưa đủ".
 *
 * Two holes, both found on Lumio Agency's inbox:
 *
 *  1. A message with no words — a photo of the nails the customer wants, a
 *     sticker, a voice note, a shared link — was thrown away when Lumio read a
 *     conversation from Meta (`filter(m => m.message)`). A customer who only
 *     sent pictures was not imported at all, and inside a conversation the
 *     pictures were simply missing. Now every such line comes in, as a photo
 *     where Meta gives one and as a short note otherwise.
 *
 *  2. "Kéo tin cũ" walked Meta's pages in one go, in memory, 100 at a time.
 *     Meta answers big pages with "Please reduce the amount of data" or a rate
 *     limit, the walk stopped quietly and said "Xong"; a deploy in the middle
 *     lost the whole walk. Now each page is saved as it comes, a refused page
 *     is asked again smaller or after a pause, the place reached is written
 *     down, and a restart carries on from there.
 */

/** What Lumio asks Meta for, per message. */
export const GRAPH_MSG_FIELDS = 'id,message,from,created_time,sticker,attachments{mime_type,image_data{url},video_data{url},file_url,name},shares{link,name}';
/** The same without the extras — the fallback when Meta refuses the full ask. */
export const GRAPH_MSG_FIELDS_PLAIN = 'id,message,from,created_time';

export interface GraphMsg {
  id?: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string } | null;
  sticker?: string | null;
  attachments?: { data?: { mime_type?: string; image_data?: { url?: string } | null; video_data?: { url?: string } | null; file_url?: string; name?: string }[] } | null;
  shares?: { data?: { link?: string; name?: string }[] } | null;
}

const httpUrl = (u: unknown): string | null => {
  const s = String(u ?? '').trim();
  return /^https:\/\//i.test(s) && s.length <= 2000 ? s : null;
};

/**
 * One Meta message as a line of the conversation, or null when there is truly
 * nothing in it. `ours` = the salon sent it (the note reads "Đã gửi", not
 * "Khách gửi", and the inbox shows the photos on the salon's side).
 */
export function graphLine(m: GraphMsg | null | undefined, ours: boolean): { content: string; images: string[] } | null {
  if (!m) return null;
  const text = String(m.message ?? '').trim();
  const atts = Array.isArray(m.attachments?.data) ? m.attachments!.data! : [];
  const images: string[] = [];
  let videos = 0, audios = 0, files = 0;
  for (const a of atts) {
    const mime = String(a?.mime_type ?? '').toLowerCase();
    const img = httpUrl(a?.image_data?.url);
    if (img || mime.startsWith('image/')) { if (img) images.push(img); else files++; continue; }
    if (mime.startsWith('video/') || a?.video_data) { videos++; continue; }
    if (mime.startsWith('audio/')) { audios++; continue; }
    files++;
  }
  const sticker = httpUrl(m.sticker);
  if (sticker) images.push(sticker);
  const links = (Array.isArray(m.shares?.data) ? m.shares!.data! : []).map((s) => httpUrl(s?.link)).filter((x): x is string => !!x);
  const pics = images.slice(0, 10);
  if (text) return { content: text, images: pics };
  const parts: string[] = [];
  const photoCount = images.length - (sticker ? 1 : 0);
  if (photoCount > 0) parts.push(photoCount === 1 ? '1 ảnh' : `${photoCount} ảnh`);
  if (sticker) parts.push('sticker');
  if (videos) parts.push('video');
  if (audios) parts.push('tin nhắn thoại');
  if (files) parts.push('file');
  if (links.length) parts.push('liên kết');
  if (!parts.length) return null;
  const head = `[${ours ? 'Đã gửi' : 'Khách gửi'} ${parts.join(', ')}]`;
  return { content: links.length ? `${head} ${links[0]}` : head, images: pics };
}

export interface GraphError { message?: string; code?: number; error_subcode?: number }

/** Meta wants smaller pages ("Please reduce the amount of data you're asking for"), or the page timed out. */
export function isTooMuchData(e: GraphError | null | undefined, timedOut = false): boolean {
  if (timedOut) return true;
  if (!e) return false;
  return e.code === 1 || e.code === 2 || /reduce the amount of data|unknown error|unexpected error|temporarily unavailable/i.test(String(e.message ?? ''));
}

/** Meta says slow down: wait, then ask the same page again. */
export function isRateLimited(e: GraphError | null | undefined): boolean {
  if (!e) return false;
  return [4, 17, 32, 613, 80001, 80006].includes(Number(e.code)) || /rate limit|too many calls|request limit reached/i.test(String(e.message ?? ''));
}

export function smallerPage(size: number): number {
  return Math.max(5, Math.floor(size / 2));
}

/** Where a pull stands — written to the salon's audit log so a restart carries on. */
export interface PullCheckpoint {
  days: number;
  since: string | null;
  startedAt: string;
  /** per source (page id, or "<page id>:ig"): Meta's `after` cursor of the next page to read */
  at: Record<string, string>;
  /** sources finished */
  done: string[];
  scanned: number;
  imported: number;
  updated: number;
  userId?: string | null;
}

export const PULL_CHECKPOINT = 'messenger.history_import_checkpoint';
export const PULL_STARTED = 'messenger.history_import_started';
export const PULL_DONE = 'messenger.history_import_done';
/** A pull left half-way longer ago than this is not picked up again by itself. */
export const PULL_RESUME_HOURS = 12;

/**
 * Given one salon's pull rows, newest first: the checkpoint to carry on from,
 * or null (finished, never started, or too old).
 */
export function resumable(rows: { action: string; createdAt: Date | string; metadata: unknown }[], now: Date = new Date()): PullCheckpoint | null {
  for (const r of rows) {
    if (r.action === PULL_DONE || r.action === PULL_STARTED) return null;
    if (r.action !== PULL_CHECKPOINT) continue;
    const age = now.getTime() - new Date(r.createdAt).getTime();
    if (!(age >= 0 && age < PULL_RESUME_HOURS * 3600_000)) return null;
    const m = (r.metadata ?? {}) as Partial<PullCheckpoint>;
    if (typeof m.days !== 'number' || !m.at || typeof m.at !== 'object') return null;
    return {
      days: m.days, since: typeof m.since === 'string' ? m.since : null, startedAt: String(m.startedAt ?? new Date(r.createdAt).toISOString()),
      at: Object.fromEntries(Object.entries(m.at).filter(([, v]) => typeof v === 'string' && v.length < 400)) as Record<string, string>,
      done: Array.isArray(m.done) ? m.done.filter((x): x is string => typeof x === 'string') : [],
      scanned: Number(m.scanned) || 0, imported: Number(m.imported) || 0, updated: Number(m.updated) || 0,
      userId: typeof m.userId === 'string' ? m.userId : null,
    };
  }
  return null;
}
