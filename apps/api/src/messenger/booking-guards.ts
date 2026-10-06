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
  + 'If you already have name + phone + service + time and the customer has NOT yet said yes to a recap, send the one-line recap and ask them to confirm; if they HAVE already confirmed, call create_booking now instead of writing text. Same language as the conversation. Send only the new reply.';

export const VAGUE_CORRECTION =
  'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
  + 'You described availability vaguely ("plenty of slots"). A customer cannot pick from that.\n'
  + 'Call check_availability for ONE day (the first day they mentioned) if you have not, then offer 2–3 concrete open times from its answer in one short line and ask which suits them. Same language as the conversation. Send only the new reply.';

// ---------------------------------------------------------------------------
// REPEATS. "Grand opening day" — the customer's answer to a recap — got the
// identical recap back from the model, and the old duplicate filter dropped
// it without a word: the customer saw nothing at all. A repeat is now sent
// back for a rewrite once, and if the model still repeats itself we send a
// short question ourselves. Silence is never the answer to a customer.
// ---------------------------------------------------------------------------

export function repeatCorrection(customerText: string): string {
  return 'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
    + `It is word for word your previous message. The customer has answered it since: "${String(customerText).slice(0, 300)}".\n`
    + 'Respond to THAT. If it agrees to your recap (a yes, or the same day/time you proposed), call create_booking now. '
    + 'If it changes or adds a detail, use it (re-check availability if the day or time changed) and recap once with the change. '
    + 'If you genuinely cannot tell what they mean, ask ONE short, specific question about the unclear part. Never send a previous message again. Same language as the conversation. Send only the new reply.';
}

/** Sent by us when the model repeats itself twice — a question, never silence. */
export function notRepeatLine(lang: string | null | undefined, previousBot: string | null | undefined): string {
  const wasRecap = /(shall i book|should i book|book it\?|đặt lịch luôn|em đặt luôn|xác nhận lại)/i.test(String(previousBot ?? ''));
  if (lang === 'vi') {
    return wasRecap
      ? 'Dạ để em chắc chắn — em đặt lịch như trên cho mình luôn nhé? Anh/chị trả lời "ok" là em đặt liền ạ.'
      : 'Dạ em chưa hiểu rõ ý anh/chị lắm — anh/chị nói rõ hơn giúp em một chút được không ạ?';
  }
  return wasRecap
    ? 'Just to be sure — shall I go ahead and book it as above? A quick "yes" is all I need 😊'
    : 'Sorry, I want to get this right — could you tell me a little more about what you mean?';
}

// ---------------------------------------------------------------------------
// QUESTIONS FIRST. "Delois Jones 3343904874 when is your grand opening" got a
// booking recap back and no date. The owner's rule (Oct 2026): a customer's
// question is answered — specifically — before the bot asks to book, and the
// recap waits until they have nothing left to ask.
// ---------------------------------------------------------------------------

/** Does the customer's message ask something? Errs on the side of yes. */
export function asksQuestion(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (/\b(when|what|where|how|why|which|who|whats|what's|how much|how long|do you|does|did you|are you|is there|is it|can i|can you|could you|will you|would you)\b/i.test(t)) return true;
  // Vietnamese — no \b (ASCII-only boundaries break on diacritics).
  if (/(khi nào|bao giờ|mấy giờ|bao nhiêu|ở đâu|chỗ nào|có .{0,30}không|được không|phải không|đúng không|thế nào|như nào|ra sao|tại sao|vì sao|là gì|gì vậy|gì ạ|nào vậy|chưa ạ|chưa vậy)/i.test(t)) return true;
  return false;
}

/** Is this reply the booking recap / a request for the go-ahead? */
export function isBookingRecap(reply: string | null | undefined): boolean {
  return /(shall i book|should i book|want me to book|book it\?|go ahead and book|is that right\?|em đặt lịch luôn|em đặt luôn|xác nhận lại|chốt lịch)/i.test(String(reply ?? ''));
}

export function questionFirstCorrection(customerText: string): string {
  return 'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
    + `The customer asked something: "${String(customerText).slice(0, 300)}". You went straight to the booking recap without answering it.\n`
    + 'Rewrite as ONE message: the first line answers exactly what they asked, specifically, from the salon facts, hours, prices and notes in this prompt (the real date, time or price). '
    + 'If the answer is not in what you were given, say you will check with the salon — never guess. '
    + 'Then, in the same message, move to the booking: the recap with "shall I book it?" if you have the service, time, name and phone; otherwise ask only for the next missing detail. '
    + 'Never end with "any other questions?". Same language as the conversation. Send only the new reply.';
}

/**
 * Did the reply answer something BEFORE the recap? The recap is fine after a
 * question — the owner wants the answer and the push to book in one message —
 * but not a recap that skips the answer ("Just to confirm: …" as line one).
 */
export function answersBeforeRecap(reply: string | null | undefined): boolean {
  const t = String(reply ?? '');
  const cue = /(just to confirm|to confirm|confirming|here'?s the recap|dạ em xác nhận lại|em xác nhận lại|xác nhận lại|shall i book|should i book|book it\?|go ahead and book)/i.exec(t);
  if (!cue) return true;
  const before = t.slice(0, cue.index)
    // pleasantries are not an answer
    .replace(/\b(great|perfect|awesome|sure|of course|got it|okay|ok|thanks|thank you|wonderful|lovely|noted)\b[!.,]*/gi, '')
    .replace(/(dạ|vâng|okie|ok ạ|tuyệt|cảm ơn( anh\/chị| chị| anh)?)[!.,]*/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return before.length >= 12;
}

/** A closing line that leads nowhere — before the booking, every message should end on a step towards it. */
export function endsOnFiller(reply: string | null | undefined): boolean {
  const lines = String(reply ?? '').trim().split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return /(any other questions|anything else (i can|you'?d like|you need)|is there anything else|let me know if you have|feel free to (ask|reach)|còn (câu hỏi|thắc mắc) (nào|gì)|cần hỏi thêm gì|có gì thắc mắc|cứ nhắn em nhé|cần gì cứ nhắn)/i.test(last);
}

export const FILLER_CORRECTION =
  'SYSTEM CORRECTION — that reply was blocked before it was sent.\n'
  + 'It ends with a line like "any other questions?" that leads nowhere. Before a booking is made, every message ends with one easy step towards it.\n'
  + 'Rewrite: keep your answer, and replace the closing line with the next step — the recap with "shall I book it?" if you have the service, time, name and phone; otherwise the ONE next missing detail (or 2–3 open times to pick from). '
  + 'Same language as the conversation. Send only the new reply.';

/**
 * A question about the booking itself — "can I come at 3pm?", "is Saturday
 * available?" — is answered BY the recap, so it is not held back by the
 * questions-first rule. Only questions about something else are.
 */
export function aboutTheBooking(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  return /(\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|available|availability|book|booking|appointment|slot|spot|works for)\b|\d{1,2}\s*(h|giờ)\b|giờ trống|còn chỗ|còn lịch|đặt lịch|lịch hẹn|hôm nay|ngày mai|thứ (hai|ba|tư|năm|sáu|bảy)|chủ nhật)/i.test(t);
}

/** The customer is not ready or is wrapping up — the polite "message us any time" is right then, not filler. */
export function customerWrappingUp(text: string | null | undefined): boolean {
  return /(not sure|let you know|i'?ll think|think about it|maybe later|just asking|just looking|just wondering|no thanks|thanks|thank you|\bbye\b|see you|chưa chắc|để (em|chị|anh|mình|tôi) (xem|suy nghĩ|tính)|hỏi thôi|hỏi trước thôi|cảm ơn|thôi ạ|khi khác)/i.test(String(text ?? ''));
}
