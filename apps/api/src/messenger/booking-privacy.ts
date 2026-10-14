/**
 * WHO MAY SEE OR CHANGE A BOOKING FROM A CHAT.
 *
 * The bot's find / reschedule / cancel tools took a typed phone number as
 * proof of identity. On Facebook, Instagram and Zalo the person behind the
 * chat is a real, traceable account; on the website's chat widget anyone can
 * type anyone's number, with no login, from any page. There, the bot now only
 * sees and changes the bookings made in that same conversation; for any other
 * booking it points to the manage link in the confirmation (or the salon).
 * Pure.
 */
export const BOOKED_HERE_KEY = (threadId: string) => `bot_booked:${threadId}`;

export const PRIVACY_REFUSAL =
  'For privacy, bookings made outside this chat cannot be looked up, moved or cancelled here. '
  + 'Tell the customer warmly to use the "manage / cancel" link in their booking confirmation (SMS or email), or to call or message the salon, '
  + 'and offer to make a NEW booking now if they want one. Do not confirm or deny whether that number has a booking.';

/** Anonymous channel: only bookings made in this conversation. */
export function isAnonymousChannel(channel: string | null | undefined): boolean {
  return channel === 'web';
}

export function visibleBookings<T extends { id: string }>(channel: string | null | undefined, rows: T[], bookedHere: Set<string>): T[] {
  return isAnonymousChannel(channel) ? rows.filter((r) => bookedHere.has(r.id)) : rows;
}

export function mayChangeBooking(channel: string | null | undefined, appointmentId: string, bookedHere: Set<string>): boolean {
  return !isAnonymousChannel(channel) || bookedHere.has(appointmentId);
}

/** Merge new ids into the remembered list (newest last, at most `cap`). */
export function rememberIds(prev: unknown, add: string[], cap = 20): string[] {
  const old = Array.isArray((prev as { ids?: unknown })?.ids) ? ((prev as { ids: unknown[] }).ids.filter((x) => typeof x === 'string') as string[]) : [];
  const out = [...old.filter((x) => !add.includes(x)), ...add.filter(Boolean)];
  return out.slice(-cap);
}
