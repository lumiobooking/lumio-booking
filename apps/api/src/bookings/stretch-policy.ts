/**
 * Stretching a visit that runs into the technician's next booking.
 *
 * WHY THIS EXISTS
 *
 * "Lưu thì có lúc báo lỗi, có lúc không." Adding time to a visit re-checked the
 * technician's calendar like a reschedule and answered "Staff member is already
 * booked for this time slot" — with no word about WHICH booking, so the desk
 * could not tell why one visit saved and the next did not. And it said it for
 * a visit that had already happened: the massage ran 30 minutes over this
 * morning, the desk records it, and the system refuses because the time now
 * touches the next customer's slot — a slot that is also already in the past.
 *
 * The rule now:
 *   - a visit that has already started (or finished) records the time it
 *     really took. An overlap is reported, never refused — the record has to
 *     match what happened;
 *   - a visit still in the future may not be stretched over another booking.
 *     The refusal names that booking, its time and the technician, and says
 *     what to do.
 *
 * Pure: tested in stretch-policy.spec.ts.
 */

export type Lang = 'vi' | 'en';

/** Started or done: the time on record should be the time it took. */
export function stretchMayOverlap(status: string, start: Date, now: Date): boolean {
  if (status === 'ARRIVED' || status === 'COMPLETED') return true;
  return start.getTime() <= now.getTime();
}

export interface Clash { staff: string; customer: string; start: Date; end: Date }

function clock(d: Date, tz: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** The refusal for a future visit, or the note on a past one. */
export function clashMessage(c: Clash, newEnd: Date, tz: string, lang: Lang, kind: 'blocked' | 'warning'): string {
  const who = c.staff || (lang === 'vi' ? 'Thợ' : 'The technician');
  const cust = c.customer || (lang === 'vi' ? 'khách khác' : 'another customer');
  const slot = `${clock(c.start, tz, lang)}–${clock(c.end, tz, lang)}`;
  const until = clock(newEnd, tz, lang);
  if (lang === 'vi') {
    return kind === 'blocked'
      ? `${who} đã có lịch ${cust} lúc ${slot}. Kéo dài tới ${until} sẽ trùng — hãy chuyển lịch kia sang thợ khác hoặc dời giờ trước, rồi lưu lại.`
      : `Đã lưu. Lưu ý: ${who} cũng có lịch ${cust} lúc ${slot}, nay chồng với lượt này (kéo dài tới ${until}).`;
  }
  return kind === 'blocked'
    ? `${who} is already booked with ${cust} at ${slot}. Stretching this visit to ${until} would overlap — give that booking to another technician or move it first, then save again.`
    : `Saved. Note: ${who} also has ${cust} at ${slot}, which now overlaps this visit (runs to ${until}).`;
}
