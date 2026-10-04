/**
 * "CHƯA ĐẾN" — a booking whose time came and went with nobody arriving.
 *
 * It stayed "Confirmed" on the calendar, indistinguishable from one that is
 * still coming. From an hour past its start it reads "Not arrived" instead,
 * so the desk can call, free the chair, or mark the no-show. The server
 * finishes the job once the salon's day is over (untouched → NO_SHOW).
 */
export const MISSED_AFTER_MIN = 60;
const OPEN = new Set(['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED']);

/** Minutes a still-open booking is past its start, or null when it is not (yet) missed. */
export function missedMinutes(b: { status: string; startTime: string }, now = Date.now()): number | null {
  if (!OPEN.has(b.status)) return null;
  const m = Math.floor((now - new Date(b.startTime).getTime()) / 60000);
  return m >= MISSED_AFTER_MIN ? m : null;
}
