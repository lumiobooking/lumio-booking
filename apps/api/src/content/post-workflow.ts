/**
 * The team's path for one post: written → designed → locked on the calendar.
 *
 * Three people touch a post — the one who writes the caption, the one who
 * makes the picture, the one who confirms the slot — and Meta's own scheduler
 * has no idea any of that is happening. So the post carries a `stage`, and
 * the calendar colours by it: a post is a colour the moment somebody starts
 * it, not only once it is done.
 *
 * The one hard rule lives here and in the service that honours it: a post
 * that is not `ready` is never `scheduled`. The sweep reads `status`, and
 * `status` is only allowed to say "scheduled" once the stage says "ready" —
 * so a draft caption with no picture cannot go out at 9:00 because somebody
 * dragged it onto a day.
 */

export type Stage = 'writing' | 'design' | 'ready';

export const STAGES: Stage[] = ['writing', 'design', 'ready'];

export function cleanStage(raw: unknown, fallback: Stage = 'ready'): Stage {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'writing' || s === 'design' || s === 'ready' ? s : fallback;
}

/** The step after this one; ready stays ready. */
export function nextStage(s: Stage): Stage {
  return s === 'writing' ? 'design' : 'ready';
}

/**
 * What `status` may be for a stage. A post still being written or designed is
 * a draft whatever the request said; a ready post keeps the status it was
 * given.
 */
export function statusFor(stage: Stage, requested: 'draft' | 'scheduled'): 'draft' | 'scheduled' {
  return stage === 'ready' ? requested : 'draft';
}

/** One-word name, for logs and the calendar tooltip. */
export const STAGE_LABEL: Record<Stage, { vi: string; en: string }> = {
  writing: { vi: 'Đang viết content', en: 'Writing' },
  design: { vi: 'Đang thiết kế', en: 'In design' },
  ready: { vi: 'Đã chốt lịch', en: 'Ready' },
};

export interface MediaRef { url: string; kind: 'image' | 'video'; driveUrl?: string }

/**
 * Keep the Drive link of every file the new media list still contains. The
 * screen sends back what it holds — url and kind — and the archive link
 * lives on the row, so a save that re-sent the media without it would throw
 * the copy away and make the sweep upload it again.
 */
export function keepDriveLinks(next: MediaRef[], prev: MediaRef[]): MediaRef[] {
  const byUrl = new Map(prev.filter((m) => m.driveUrl).map((m) => [m.url, m.driveUrl as string]));
  return next.map((m) => (m.driveUrl || !byUrl.has(m.url) ? m : { ...m, driveUrl: byUrl.get(m.url) }));
}

/** The files the archive has not copied yet. */
export function unarchived(media: MediaRef[]): MediaRef[] {
  return media.filter((m) => !m.driveUrl && /^https?:\/\//i.test(m.url));
}

/**
 * The Drive folder's name for a post: the salon's day and the first words of
 * the caption, so a person browsing the archive for "the Tết post" finds it
 * without opening anything.
 */
export function postFolderName(localDay: string, message: string): string {
  const words = String(message ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
  return `${localDay} ${words || 'bai-dang'}`.slice(0, 80).trim();
}

/** The archive file's name: order first, so the carousel reads in order. */
export function mediaFileName(index: number, m: MediaRef): string {
  const fromUrl = (() => { try { return new URL(m.url).pathname.split('/').pop() ?? ''; } catch { return ''; } })();
  const ext = (fromUrl.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (m.kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  return `${String(index + 1).padStart(2, '0')}.${ext}`;
}
