import { bi, enOf, viOf, type Txt } from './i18n';
import { isMediaAsk, isSalonWork, type JobOwner } from './work-owner';
import type { JobKind } from './weekly-plan';

/**
 * The ONE thing the salon is asked for this week.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A shop that hires an agency is buying the right not to think about
 * marketing. The first version of its screen handed it the agency's own
 * working plan: four or five rows marked TIỆM LÀM, each with a six-step
 * technical shot list. Three things followed, and all three are bad for the
 * agency: the owner feels billed for homework; she has no camera training so
 * the steps go untouched and every week reads 0/6 as though the shop were
 * failing; and the agency's own work sits in the same list at the same weight,
 * so the thing she is paying for becomes invisible.
 *
 * WHAT THE SHOP IS ASKED FOR, AND NOTHING ELSE
 *
 * Only what nobody else can do: raw material from inside the shop. The camera
 * is in that room and the agency is not. Filming and photographing are one
 * physical act — you set the phone up once — so they are ONE ask, with one
 * deadline and one button, however many jobs the plan splits them into.
 *
 * Everything else on the week belongs to Lumio, including replying to
 * comments, updating the Google profile and messaging regulars. Asking a
 * happy customer for a review is genuinely the shop's — it happens at the
 * counter with a person standing there — but it is a habit, not a task with
 * steps, so it travels as one soft line beside the ask rather than as work.
 *
 * THE DEADLINE IS NOT INVENTED
 *
 * It is the day the first post goes out. That is the real constraint and the
 * one that makes the ask feel like a colleague's request rather than a due
 * date somebody picked: material is needed before it can be published.
 */

/** The media ask: one physical act, one deadline, one button. See work-owner. */
export const ASK_KINDS: JobKind[] = ['film', 'photo'];
/**
 * WAS: "habits at the counter — the shop's".
 *
 * It named `engage`, which is replying to comments, messages and Google
 * reviews — desk work this agency does from another country. Filing it as the
 * shop's put it on the shop's screen AND kept it out of the team's queue
 * (crew-board excluded it too), so it belonged to nobody. Ownership is in
 * ./work-owner now and this list is empty rather than wrong.
 */
export const COUNTER_KINDS: JobKind[] = [];
/** Jobs whose day is a publishing day: the ask has to land before the first one. */
const PUBLISH_KINDS: JobKind[] = ['post', 'story', 'offer', 'gbp'];

export interface AskJobLike {
  id?: string;
  kind: JobKind;
  who?: JobOwner;
  dayIndex: number;
  day: Txt;
  text: Txt;
}

export interface WeeklyAsk {
  /** The jobs behind it — a tick or an edit still lands on the real thing. */
  jobIds: string[];
  /** What is being asked for, in one line a busy owner reads once. */
  what: Txt;
  /** "trước Thứ 3" — the day the first post needs it. */
  by: Txt;
  /** Which day that is, so the screen can colour it when it is close. */
  byDayIndex: number;
  /**
   * EVERYTHING ELSE THIS WEEK THAT ONLY THE SHOP CAN DO.
   *
   * The header of this file promises the shop ONE ask a week. That promise was
   * kept by counting only filming and photography — while partnership jobs,
   * printing, and anything else physical went out on the same screen without
   * passing through here. The owner was told "one thing" and shown four.
   *
   * They are listed rather than folded into `what`, because they are not one
   * physical act: you cannot set the phone on a stand once and also have
   * printed thirty cards. Listing them is what makes the real size of the ask
   * visible — to the client, and to us before we promise it.
   */
  also: Txt[];
}

/** "3 clip" / "6 ảnh", counted from the instruction the plan wrote. */
function countIn(text: Txt): number | null {
  const m = /(\d+)/.exec(viOf(text));
  return m ? Math.max(1, Math.min(99, Number(m[1]))) : null;
}

function joinVi(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} và ${parts[parts.length - 1]}`;
}
function joinEn(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Fold every filming and photography job into one ask.
 *
 * Returns null when the week asks the shop for nothing — a real state, and one
 * the screen should say plainly rather than inventing a chore to fill space.
 */
export function weeklyAsk(jobs: AskJobLike[], dayLabels: Txt[]): WeeklyAsk | null {
  const mine = jobs.filter((j) => isMediaAsk(j));
  // Salon-owned work that is NOT the media sitting: partnerships, print,
  // anything else needing hands in the room.
  const also = jobs.filter((j) => isSalonWork(j) && !isMediaAsk(j)).map((j) => j.text);
  if (!mine.length) {
    // No filming this week does not mean nothing is asked of the shop. Saying
    // "nothing for you" while a partnership job sits on the same screen is the
    // exact mismatch this field exists to close.
    if (!also.length) return null;
    const d = Math.max(...jobs.filter((j) => isSalonWork(j)).map((j) => j.dayIndex));
    const lb = dayLabels[d];
    return {
      jobIds: jobs.filter((j) => isSalonWork(j)).map((j) => j.id).filter((id): id is string => Boolean(id)),
      what: bi('Tuần này không cần quay chụp', 'No filming needed this week'),
      by: d === 0
        ? bi('trong hôm nay', 'today')
        : bi(`trước ${viOf(lb) || `ngày ${d + 1}`}`, `by ${enOf(lb) || `day ${d + 1}`}`),
      byDayIndex: d,
      also,
    };
  }

  const clips = mine.filter((j) => j.kind === 'film').reduce((n, j) => n + (countIn(j.text) ?? 1), 0);
  const photos = mine.filter((j) => j.kind === 'photo').reduce((n, j) => n + (countIn(j.text) ?? 1), 0);
  const viParts: string[] = [];
  const enParts: string[] = [];
  if (clips) { viParts.push(`${clips} clip ngắn`); enParts.push(`${clips} short clips`); }
  if (photos) { viParts.push(`${photos} tấm ảnh`); enParts.push(`${photos} photos`); }
  const what = bi(
    `Quay ${joinVi(viParts)} — một buổi, bằng điện thoại. Bên em lo dựng, viết bài và đăng.`,
    `${joinEn(enParts)} — one sitting, on your phone. We do the editing, the writing and the posting.`,
  );

  // The first publishing day AFTER the earliest ask, when there is one.
  const from = Math.min(...mine.map((j) => j.dayIndex));
  const publish = jobs
    .filter((j) => PUBLISH_KINDS.includes(j.kind) && j.dayIndex > from)
    .map((j) => j.dayIndex)
    .sort((a, b) => a - b)[0];
  const byDayIndex = publish ?? Math.max(...mine.map((j) => j.dayIndex));
  const label = dayLabels[byDayIndex];
  const by = byDayIndex === 0
    ? bi('trong hôm nay', 'today')
    : bi(`trước ${viOf(label) || `ngày ${byDayIndex + 1}`}`, `by ${enOf(label) || `day ${byDayIndex + 1}`}`);

  return {
    jobIds: mine.map((j) => j.id).filter((id): id is string => Boolean(id)),
    what,
    by,
    byDayIndex,
    also,
  };
}
