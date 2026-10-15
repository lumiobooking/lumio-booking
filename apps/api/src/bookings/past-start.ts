/**
 * How far in the past a booking may start.
 *
 * Online, chat, hotline and plugin bookings (no staff user behind them) must
 * start in the future — two minutes of slack only, for a slow phone or a clock
 * a little off. A booking typed at the desk is different: the customer is often
 * already in the chair ("she came in at 3:30, I'm entering it now"), or the desk
 * is writing up the afternoon after the rush. Refusing those with "startTime is
 * in the past" sent staff to invent a fake future time. Staff may record a
 * booking up to 12 hours back; anything older is a mistake (wrong day, AM/PM).
 *
 * The message keeps its old start ("startTime is in the past") so the screens
 * that translate it still recognise it.
 */
export const PUBLIC_PAST_GRACE_MS = 2 * 60_000;
export const DESK_PAST_GRACE_MS = 12 * 60 * 60_000;

export function pastStartProblem(start: Date, now: number, byStaff: boolean): string | null {
  const grace = byStaff ? DESK_PAST_GRACE_MS : PUBLIC_PAST_GRACE_MS;
  if (start.getTime() >= now - grace) return null;
  return byStaff
    ? 'startTime is in the past — a booking can be recorded up to 12 hours back. Check the date and AM/PM.'
    : 'startTime is in the past';
}
