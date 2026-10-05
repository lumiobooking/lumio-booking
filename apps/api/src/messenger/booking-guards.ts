/**
 * The gates a BOOKING reply must pass before it is sent.
 *
 * A prompt is advice; this is a gate. The Zb Nails & Spa Instagram chat
 * (Oct 2026) had the bot write "Great — Monday at 11:00 AM is booked in.
 * What's your first name?" — a booking announced before a name or phone
 * existed, so before create_booking could even have been called. A customer
 * who reads that and closes the chat walks in to no appointment. The prompt
 * already said "only confirm after SUCCESS"; the model said it anyway. So the
 * service now checks the reply against what actually happened in the run.
 *
 * Pure string functions, like ./sales-guards: no database, tests in
 * milliseconds. A false positive costs one extra model call; a false negative
 * costs a customer who believes they are booked.
 */

/**
 * Clauses that talk about a booking that has NOT happened yet — "once you're
 * booked you'll get a text", "sau khi em đặt xong". Removed before matching so
 * a promise about the future is not mistaken for a claim about the past.
 */
const CONDITIONAL = [
  /\b(once|after|when|as soon as|before|until|so that|so I can|to get you|if)\b[^.!?\n]*/gi,
  /(sau khi|ngay khi|khi nào|để em|nếu)[^.!?\n]*/gi,
];

const CLAIMS_BOOKED: RegExp[] = [
  // "Monday at 11 is booked in", "you're booked", "it's reserved", "you are all confirmed"
  /\b(is|are|you'?re|you are|it'?s|that'?s|has been|have been|got you)\s+(all\s+|now\s+)?(booked|reserved|scheduled|confirmed)\b/i,
  /\bbooked\s+(in|you)\b/i,
  // "I've booked you", "we've reserved", "I have put you down"
  /\b(i'?ve|i have|we'?ve|we have|i just|i)\s+(booked|reserved|scheduled|confirmed|put you down|pencil+ed you)/i,
  /\b(all set|locked in|you'?re set)\b/i,
  /\bpencil+ed\s+(you\s+)?in\b/i,
  /\bsee you (then|on \w+|at \d)/i,
  // Vietnamese — no \b: word boundaries are ASCII-only and break on diacritics.
  /(em|bên em|tiệm|mình|shop)\s+(đã|vừa)\s+(đặt|book|giữ|xác nhận|lên lịch|ghi lịch)/i,
  /lịch[^.!?\n]{0,30}(đã được|đã)\s+(đặt|xác nhận|giữ|book)/i,
  /(đặt|book|giữ)\s+(lịch\s+|chỗ\s+)?(xong|thành công)/i,
  /(hẹn gặp|gặp lại)\s+(anh\/chị|anh|chị|bạn|em)\s+(vào|lúc|nhé|nha)/i,
];

/** Does this reply tell the customer they are already booked? */
export function claimsBooked(reply: string): boolean {
  let t = String(reply ?? '');
  if (!t.trim()) return false;
  for (const c of CONDITIONAL) t = t.replace(c, ' ');
  // A question about an EXISTING booking ("đã đặt lịch trước chưa?") is not a claim.
  t = t.replace(/[^.!?\n]*chưa\s*(ạ|vậy|nhỉ)?\s*\?/gi, ' ');
  return CLAIMS_BOOKED.some((re) => re.test(t));
}

/**
 * Availability described in words a customer cannot choose from: "plenty of
 * slots", "we're pretty open". Only flagged when the reply names no concrete
 * time at all — "plenty of room, 10:00 or 2:00?" is fine.
 */
const VAGUE = [
  /\b(plenty|lots|loads|a lot|tons) of (slots|openings|availability|times|room|space|spots)\b/i,
  /\b(pretty|wide|very|fairly|quite) open\b/i,
  /\bwide open\b/i,
  /(còn|trống)\s+(rất\s+)?nhiều\s+(giờ|chỗ|slot|lịch)/i,
  /(nhiều|thoải mái)\s+(giờ|chỗ|slot)\s+(trống|lắm)/i,
];
const HAS_TIME = /(\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(h|giờ)\b|\bnoon\b|\btrưa\b)/i;

export function vagueAvailability(reply: string): boolean {
  const t = String(reply ?? '');
  if (!t.trim() || HAS_TIME.test(t)) return false;
  return VAGUE.some((re) => re.test(t));
}

/**
 * Is the bot allowed to talk about a booking as made, in this run?
 * Yes when create_booking SUCCEEDED now, when this customer already has an
 * upcoming appointment on the salon's calendar (a "thanks" after last turn's
 * booking, or a returning customer), or when the run looked an appointment up.
 */
export function mayTalkAsBooked(o: { bookedNow: boolean; upcoming: number; toolsUsed: ReadonlySet<string> }): boolean {
  if (o.bookedNow || o.upcoming > 0) return true;
  return ['find_appointment', 'reschedule_appointment', 'cancel_appointment'].some((n) => o.toolsUsed.has(n));
}

/** Sent ourselves when the model claims a booking twice in a row. */
export function notBookedYetLine(lang: string | null | undefined): string {
  return lang === 'vi'
    ? 'Dạ giờ đó được ạ 👍 Anh/chị cho em xin tên và số điện thoại để em đặt lịch luôn nhé?'
    : 'That time works 👍 What name and phone number should I put the booking under?';
}

export const BOOKED_CORRECTION =
  'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
  + 'You told the customer the appointment is booked/confirmed, but create_booking has NOT returned SUCCESS in this conversation — nothing is on the calendar.\n'
  + 'Rewrite: say the time works (do not say booked, reserved, confirmed, all set or see you), then ask for whatever is still missing — name and phone number together in ONE question if both are missing. '
  + 'If you already have name + phone + service + time, call create_booking now instead of writing text. Same language as the conversation. Send only the new reply.';

export const VAGUE_CORRECTION =
  'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
  + 'You described availability vaguely ("plenty of slots"). A customer cannot pick from that.\n'
  + 'Call check_availability for ONE day (the first day they mentioned) if you have not, then offer 2–3 concrete open times from its answer in one short line and ask which suits them. Same language as the conversation. Send only the new reply.';
