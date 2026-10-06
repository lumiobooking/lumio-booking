/**
 * CLOCKS ON THE FRONT DESK — always the salon's, never the browser's.
 *
 * The desk printed every time with the browser's own clock. A manager or the
 * Lumio support team reading a Los Angeles salon from Vietnam saw the 10:00 AM
 * bookings as "0:00", a 11:40 PM one as "13:40", and the header said Tuesday
 * while the salon was still on Monday. Every clock here takes the salon's
 * timezone (from the board itself), so who is looking no longer matters.
 */

function fmt(tz: string | null | undefined, vi: boolean, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try { return new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-US', { ...o, ...(tz ? { timeZone: tz } : {}) }); }
  catch { return new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-US', o); }
}

/** "10:00" / "10:00 AM" in the salon's timezone. */
export function clockIn(at: string | number | Date | null | undefined, tz: string | null | undefined, vi: boolean): string {
  if (at === null || at === undefined || at === '') return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return fmt(tz, vi, { hour: vi ? '2-digit' : 'numeric', minute: '2-digit', hour12: !vi }).format(d);
}

/** "Thứ Hai, 5 tháng 10" — the salon's today, not the viewer's. */
export function salonDayLabel(now: number | Date, tz: string | null | undefined, vi: boolean): string {
  return fmt(tz, vi, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(now));
}

export type Arrival =
  | { kind: 'late'; minutes: number }   // booked time has passed, not checked in
  | { kind: 'now'; minutes: 0 }         // within 5 minutes either side
  | { kind: 'soon'; minutes: number }   // due within the next 30 minutes
  | { kind: 'later'; minutes: number }; // later today

/** Where a booking stands against the clock: how soon, or how late. */
export function arrivalState(startIso: string | Date, now: number): Arrival {
  const diff = (new Date(startIso).getTime() - now) / 60000;
  if (diff < -5) return { kind: 'late', minutes: Math.round(-diff) };
  if (diff <= 5) return { kind: 'now', minutes: 0 };
  if (diff <= 30) return { kind: 'soon', minutes: Math.round(diff) };
  return { kind: 'later', minutes: Math.round(diff) };
}

/** "25′" / "2g 10′" (vi) or "2h 10′". */
export function minutesText(m: number, vi: boolean): string {
  const h = Math.floor(m / 60); const r = m % 60;
  if (!h) return `${r}′`;
  return `${h}${vi ? 'g' : 'h'}${r ? ` ${r}′` : ''}`;
}
