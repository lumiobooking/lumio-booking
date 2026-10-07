/**
 * THE REPORT'S MONTH, IN THE SALON'S OWN CLOCK.
 *
 * Post counts used UTC months: for a salon in Alberta (UTC-6/-7) a post made
 * at 8 PM on the 31st counted in the NEXT month, and the first evening of the
 * month was missing. The window is now midnight-to-midnight in the salon's
 * timezone. Pure.
 */
import { wallTimeToUtcTz } from '../common/salon-time';

export interface MonthWindow { from: number; to: number } // epoch ms, [from, to)

export function monthWindow(month: string, tz?: string | null): MonthWindow {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  if (!tz) return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) };
  return { from: wallTimeToUtcTz(first, '00:00', tz).getTime(), to: wallTimeToUtcTz(next, '00:00', tz).getTime() };
}

/** A post's time inside the window. A post that cannot prove its time is not counted. */
export function inWindow(ts: unknown, w: MonthWindow): boolean {
  const t = Date.parse(String(ts ?? ''));
  return Number.isFinite(t) && t >= w.from && t < w.to;
}

/**
 * Does this Facebook item count as the salon's own post?
 * The `feed` edge also carries what OTHER people posted on the Page, and Facebook
 * logs a new profile picture or cover photo as a "post". Neither is the salon
 * publishing content.
 */
export function isOwnFbPost(it: { from?: { id?: string } | null; story?: string | null; message?: string | null }, pageId: string): boolean {
  if (it.from?.id && String(it.from.id) !== String(pageId)) return false;
  if (!it.message && /\b(profile picture|cover photo|ảnh đại diện|ảnh bìa)\b/i.test(String(it.story ?? ''))) return false;
  return true;
}
