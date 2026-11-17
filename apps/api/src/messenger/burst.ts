/**
 * What to do when a customer sends five messages in four seconds.
 *
 * THE BUG THIS EXISTS TO KILL
 *
 * Every inbound Messenger event started its own reply. Tap a quick-reply
 * button five times — which people do when a page feels slow, or when they
 * are on a phone and not sure the tap registered — and five agent runs start
 * at once. None of them can see the others (each reads the thread history
 * before any of them has written to it), so the customer gets the same
 * paragraph five times. It reads like a broken machine, and the one thing a
 * salon is buying here is a page that reads like a person.
 *
 * THE FIX IS THE ONE A PERSON USES
 *
 * A receptionist does not answer each line as it lands; they wait a beat to
 * see if more is coming, and then answer once. So do we: a short collecting
 * window, everything that arrives inside it merged into one turn, one reply.
 * That fixes the duplicate taps AND the far more common case of somebody
 * typing "Tôi tên An" / "SĐT 0909..." / "Thứ 5 nhé" as three messages — which
 * used to produce three replies, each answering a third of the question.
 */

/** How long to wait for the rest of a burst before answering. */
export const BURST_MS = 6_000;

/* ------------------------------------------------------------------------ *
 * THE ADAPTIVE WAIT (released in stages — common/ai-release "smartWait")
 *
 * Six seconds before EVERY reply was the largest single part of the 14 seconds
 * a customer waited on production (17/11/2026): a tap on a button waited as
 * long as somebody typing a paragraph in pieces.
 *
 * The wait is only there to let a customer finish what they are saying. So it
 * is sized by what they just sent — and the gathering does not end with it:
 * a message that lands while the reply is being written still drops that
 * draft and is answered together with the rest (the supersede rule below),
 * so a short wait costs a wasted draft now and then, never two half-answers.
 * ------------------------------------------------------------------------ */

/** A tap on a button: the customer has said all they meant to. */
export const WAIT_TAP_MS = 300;
/** A whole question or a full sentence. */
export const WAIT_COMPLETE_MS = 1_000;
/** Something in between. */
export const WAIT_DEFAULT_MS = 1_500;
/** "hi", "alo", "shop ơi", a lone photo: the real message is almost certainly still coming. */
export const WAIT_FRAGMENT_MS = 3_200;
/** The customer wrote again this recently: give them a moment more, a few times at most. */
export const SETTLE_WITHIN_MS = 700;
export const SETTLE_EXTRA_MS = 900;
export const SETTLE_MAX = 3;

const QUESTION_START = /^(what|when|where|which|who|why|how|do|does|did|can|could|is|are|will|would|may|should|have|has|cu[aá]nto|cu[aá]ndo|d[oó]nde|qu[eé]|tienen|puedo|bao nhiêu|mấy giờ|khi nào|ở đâu|có|còn|giá|cho hỏi|cho em hỏi|cho mình hỏi|cho chị hỏi|cho anh hỏi|tư vấn|đặt lịch|book)(?=[\s,?!.]|$)/iu;
/** An asking phrase anywhere in the sentence. */
const QUESTION_INSIDE = /(mấy giờ|bao nhiêu|bao lâu|khi nào|ở đâu|thế nào|làm sao|là gì|được không|how much|how long|what time|cuánto|cuándo)/iu;
/** A greeting or a call for attention with nothing else in it. */
const OPENER = /^(hi+|hello+|hey+|helo|alo+|alô|a lô|chào|xin chào|chao|hola|buenas|good (morning|afternoon|evening)|(shop|em|chị|anh|bạn|ad|admin|tiệm|quán|bác sĩ) ơi)[\s,.!]*((shop|em|chị|anh|bạn|ad|admin|there|team|tiệm|quán|ạ)[\s,.!]*)?$/iu;
/** Vietnamese asks at the END of the sentence: "… không", "… chưa", "… bao nhiêu", "… ạ". */
const QUESTION_END = /(?:^|\s)(không|ko|hông|hok|chưa|hả|nhỉ|vậy|sao|nào|đâu|bao nhiêu|ạ)\s*[.!]*$/iu;

/**
 * How long to wait before answering what is in the queue.
 * `tap` = the newest message was a button; `media` = a photo or file came with it.
 */
export function burstWaitMs(texts: readonly string[], o: { tap?: boolean; media?: boolean } = {}): number {
  const last = String(texts[texts.length - 1] ?? '').trim();
  if (o.tap && texts.length <= 1) return WAIT_TAP_MS;
  // A photo often arrives a second before its caption.
  if (o.media && texts.length <= 1) return WAIT_FRAGMENT_MS;
  if (!last) return WAIT_DEFAULT_MS;
  const words = last.split(/\s+/u).filter(Boolean).length;
  const asks = /[?？]\s*$/u.test(last) || QUESTION_START.test(last) || QUESTION_END.test(last) || QUESTION_INSIDE.test(last);
  if (OPENER.test(last)) return WAIT_FRAGMENT_MS;
  if (asks && words >= 2) return WAIT_COMPLETE_MS;
  if (words >= 7) return WAIT_COMPLETE_MS;
  // "Yes", "Tuesday", "10am", a name, a phone number: usually the whole answer to what was asked.
  return WAIT_DEFAULT_MS;
}

/**
 * After the wait: did ANOTHER message land during it, a moment ago? Then wait a
 * little more (bounded). The message the wait was started for does not count.
 */
export function settleMs(lastArrivalMs: number | null | undefined, waitStartedMs: number, nowMs: number, extended: number): number {
  if (lastArrivalMs == null || extended >= SETTLE_MAX) return 0;
  if (lastArrivalMs <= waitStartedMs) return 0;
  return nowMs - lastArrivalMs < SETTLE_WITHIN_MS ? SETTLE_EXTRA_MS : 0;
}


/**
 * How many replies in a row may be dropped because the customer wrote again
 * while they were being written (MessengerService.drainBurst). Two: somebody
 * typing non-stop still gets an answer within three passes.
 */
export const MAX_SUPERSEDE = 2;

/**
 * Tools that only LOOK. A reply whose run used anything else (booked, moved or
 * cancelled a visit, sent photos or price cards, saved a contact, logged a
 * callback) is never dropped for a newer message: the customer must hear what
 * was done, and a second run would do it again.
 */
export const READ_ONLY_TOOLS = new Set(['check_availability', 'find_appointment', 'get_pricing', 'get_services', 'get_software_plans', 'quote_price']);

/**
 * THINK AHEAD — the wait and the work overlap instead of adding up.
 *
 * The wait before answering exists so that a customer who is still typing
 * gets ONE answer. Until 18/11/2026 the AI sat idle for that wait and only
 * then began: a greeting waited 3.2 s and was then worked on for 3.5 s.
 * Where this is released (common/ai-release "thinkAhead") the AI starts the
 * moment the message lands, and the finished reply is HELD until the pause
 * the customer would have been given is over:
 *
 *   - a message that lands inside that pause is the same burst: the draft is
 *     dropped and everything is answered once, exactly as the wait did;
 *   - nothing that DOES something (a booking, a card, a saved contact) runs
 *     before the pause is over — only looking is done early;
 *   - the reply goes out at max(pause, work), not pause + work.
 */
/** Messages inside the customer's own pause are merged at most this many times in a row, so somebody typing non-stop is still answered. */
export const MAX_MERGE = 6;

/** Until when a finished reply is held: the customer's pause, counted from their newest message. */
export function holdUntilMs(lastArrivalMs: number | null | undefined, windowMs: number, nowMs: number): number {
  const from = typeof lastArrivalMs === 'number' && Number.isFinite(lastArrivalMs) && lastArrivalMs <= nowMs ? lastArrivalMs : nowMs;
  return from + Math.max(0, windowMs);
}

/**
 * A newer message made this draft stale. Did it land inside the pause (the
 * same burst — a merge, as the wait used to do) or after it, while the AI was
 * still working (a supersede, capped by MAX_SUPERSEDE)?
 */
export function dropKind(firstNewArrivalMs: number | null | undefined, holdUntil: number): 'merge' | 'supersede' {
  return typeof firstNewArrivalMs === 'number' && firstNewArrivalMs <= holdUntil ? 'merge' : 'supersede';
}

/** Must this tool wait until the customer's pause is over? Everything that is not only looking. */
export function needsPause(tool: string | null | undefined): boolean {
  return !READ_ONLY_TOOLS.has(String(tool ?? ''));
}

/** What a run returns when it stopped because the customer wrote again: nothing was done, nothing is sent. */
export const ABANDONED = '\u0000__lumio_abandoned__';

/** May a reply written with these tools be dropped and rewritten? */
export function mayDropReply(toolsUsed: Iterable<string>): boolean {
  for (const t of toolsUsed) if (!READ_ONLY_TOOLS.has(t)) return false;
  return true;
}

/** An exactly-repeated reply is worth nothing to the reader for this long. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Several messages, as one turn for the agent.
 *
 * Identical lines collapse: the same button tapped twice is a customer who
 * was not sure the first tap worked, not a customer saying it twice as hard.
 * Different lines stay, in order, because "An" then "0909..." then "Thứ 5" is
 * one thought delivered in three keystrokes and the agent needs all of it.
 */
export function mergeBurst(texts: string[]): string {
  const out: string[] = [];
  for (const raw of texts ?? []) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    if (out.some((p) => norm(p) === norm(t))) continue;
    out.push(t);
  }
  return out.join('\n');
}

/**
 * Would sending this repeat, word for word, what we just said?
 *
 * Only the MOST RECENT reply counts. Saying the same sentence again after
 * saying something else in between is a normal conversation; saying it twice
 * in a row is a stutter, and a stutter carries no information the customer
 * does not already have on screen.
 */
export function alreadySaid(
  history: { role?: string; content?: unknown; at?: string; failed?: boolean }[],
  reply: string,
  nowMs: number = Date.now(),
  withinMs: number = REPEAT_WINDOW_MS,
): boolean {
  const want = norm(reply);
  if (!want) return false;
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    // A reply the platform refused never reached the customer, so it cannot
    // be "already said" — saying it again is the whole point of retrying.
    if (turn.failed) continue;
    if (norm(turn.content) !== want) return false;
    const at = turn.at ? Date.parse(turn.at) : NaN;
    // No timestamp on an old turn: treat it as recent rather than send a
    // duplicate on the strength of a missing field.
    return !Number.isFinite(at) || nowMs - at < withinMs;
  }
  return false;
}

/**
 * THE SAME QUESTION, AGAIN AND AGAIN.
 *
 * An ad's "how do I get a consultation?" button tapped six times, a bot
 * replaying one line every few minutes: answering each one is a paragraph the
 * person already has on screen, a model call, and a Page that looks broken.
 * Two answers to the same words are enough. From the third time in half an
 * hour the bot says nothing; from the fifth the thread goes to Spam, where it
 * stays quiet until someone at the salon says it is not spam.
 */
export const REPEAT_SPAM_WINDOW_MS = 30 * 60_000;
/** Earlier identical customer messages before the bot stops answering this one. */
export const REPEAT_SILENT_AT = 2;
/** Earlier identical customer messages before the thread is moved to Spam. */
export const REPEAT_SPAM_AT = 4;

/** How many times the customer already sent exactly this (spacing and case aside) in the window. */
export function repeatCount(
  history: { role?: string; content?: unknown; at?: string }[],
  text: string,
  nowMs: number = Date.now(),
  withinMs: number = REPEAT_SPAM_WINDOW_MS,
): number {
  const want = norm(text);
  if (!want) return 0;
  let n = 0;
  for (const turn of history ?? []) {
    if (turn?.role !== 'user') continue;
    // A turn may hold a merged burst ("a\nb"): any of its lines counts.
    const lines = String(turn.content ?? '').split('\n').map(norm);
    if (!lines.includes(want) && norm(turn.content) !== want) continue;
    const at = turn.at ? Date.parse(turn.at) : NaN;
    if (Number.isFinite(at) && nowMs - at > withinMs) continue;
    n += 1;
  }
  return n;
}

/**
 * Did the customer get a DELIVERED answer after an earlier copy of this text?
 * A customer repeating a question because the bot's replies never reached them
 * (Meta refused them — failed turns) is not a spammer and must be answered:
 * silencing them is the "AI stopped answering" this guard must never cause.
 */
export function repeatWasAnswered(
  history: { role?: string; content?: unknown; at?: string; failed?: boolean }[],
  text: string,
): boolean {
  const want = norm(text);
  if (!want) return false;
  let seenCopy = false;
  for (const turn of history ?? []) {
    if (turn?.role === 'user') {
      const lines = String(turn.content ?? '').split('\n').map(norm);
      if (lines.includes(want) || norm(turn.content) === want) seenCopy = true;
    } else if (seenCopy && turn?.role === 'assistant' && !turn.failed) {
      return true;
    }
  }
  return false;
}

/** What the bot does with this message: answer, stay quiet, or stay quiet and move the thread to Spam. */
export function repeatVerdict(priorRepeats: number): 'answer' | 'silent' | 'spam' {
  if (priorRepeats >= REPEAT_SPAM_AT) return 'spam';
  if (priorRepeats >= REPEAT_SILENT_AT) return 'silent';
  return 'answer';
}
