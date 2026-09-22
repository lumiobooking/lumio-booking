/**
 * Who is up next on a salon, as the team says it is — picked by hand from the
 * agency list by whoever just finished their part. Nothing sets it on its own
 * and nothing reads it except that list: it is a note from one department to
 * the next, not a status the system infers.
 *
 * '' means nobody has picked one; the list then shows "— chọn —".
 */

export const WORK_NEXT_KEY = 'work_next';

export type WorkNext = 'content' | 'design' | 'review' | 'schedule' | 'done';

export const WORK_NEXT: readonly WorkNext[] = ['content', 'design', 'review', 'schedule', 'done'];

/** '' clears the label. */
export function isWorkNext(v: unknown): v is WorkNext | '' {
  return v === '' || (typeof v === 'string' && (WORK_NEXT as readonly string[]).includes(v));
}

/** The stored value, read safely: anything unreadable is "not picked". */
export function workNextOf(stored: unknown): WorkNext | '' {
  const v = stored && typeof stored === 'object' ? (stored as { next?: unknown }).next : null;
  return typeof v === 'string' && (WORK_NEXT as readonly string[]).includes(v) ? (v as WorkNext) : '';
}
