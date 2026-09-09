/**
 * Steps the system can see for itself get ticked by the system.
 *
 * WHY
 *
 * "Dán caption bên dưới" and "Đăng Instagram + Facebook cùng lúc" were tick
 * boxes on the sheet — and the thing that ticks them is the posting queue,
 * which already knows whether a post for that day has a caption, has media,
 * and went out. Asking a person to confirm what the machine did is the kind
 * of chore that makes a checklist feel like homework, and a checklist that
 * feels like homework stops being read.
 *
 * WHAT IS NOT TICKED HERE
 *
 * Only what the queue can prove. Pinning a comment, answering comments in
 * the first half hour, the text overlay in the edit, TikTok (which nothing
 * here publishes): those stay with the person, because a tick the system
 * cannot stand behind is worse than an empty box.
 */

/** What a step needs to be true for the machine to tick it. */
export type AutoKey = 'media' | 'video' | 'caption' | 'posted';

export interface PostEvidence {
  /** Local calendar day "YYYY-MM-DD" the post is scheduled for. */
  day: string;
  status: string;
  /** Number of media items, and whether any is a video. */
  mediaCount: number;
  hasVideo: boolean;
  /** A non-empty caption. */
  hasMessage: boolean;
}

/** What the queue holds for one day, folded to the facts the steps need. */
export interface DayEvidence {
  scheduled: boolean;
  media: boolean;
  video: boolean;
  caption: boolean;
  posted: boolean;
}

const LIVE = new Set(['scheduled', 'publishing', 'posted']);

/**
 * The strongest post of the day decides.
 *
 * A day may hold a draft and a scheduled post; the scheduled one is the
 * evidence. Two scheduled posts and one has media: media is true — the step
 * says "pick the clip", and a clip was picked.
 */
export function evidenceForDay(posts: PostEvidence[], day: string): DayEvidence {
  const mine = posts.filter((p) => p.day === day && p.status !== 'cancelled' && p.status !== 'expired');
  const live = mine.filter((p) => LIVE.has(p.status));
  return {
    scheduled: live.length > 0,
    media: live.some((p) => p.mediaCount > 0),
    video: live.some((p) => p.hasVideo),
    caption: live.some((p) => p.hasMessage),
    posted: live.some((p) => p.status === 'posted'),
  };
}

/**
 * Which step indexes the evidence proves, for a sheet whose steps declare
 * what would prove them. A step with no declaration is a person's.
 */
export function autoDone(auto: Record<number, AutoKey> | undefined, ev: DayEvidence): number[] {
  if (!auto) return [];
  const out: number[] = [];
  for (const [idx, key] of Object.entries(auto)) {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) continue;
    const ok = key === 'media' ? ev.media
      : key === 'video' ? ev.video
        : key === 'caption' ? ev.scheduled && ev.caption
          : key === 'posted' ? ev.posted
            : false;
    if (ok) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/** Ticks a person made, plus the machine's — the machine's never removed by a person's untick. */
export function mergeTicks(manual: number[] | undefined, auto: number[]): number[] {
  return Array.from(new Set([...(manual ?? []), ...auto])).sort((a, b) => a - b);
}
