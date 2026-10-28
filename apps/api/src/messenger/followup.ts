/**
 * NHẮN LẠI KHÁCH BỎ LỬNG — remarketing that does not get the Page restricted.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE
 *
 * Meta lets a Page write freely for 24 hours after the customer's last
 * message, and after that only a HUMAN may write (the HUMAN_AGENT tag, seven
 * days — see human-agent.ts, which already refuses to lend that tag to the
 * bot). There is no tag that lets an automation send marketing to somebody who
 * went quiet two days ago. Doing it anyway is how a salon loses its Page.
 *
 * So this is not "message the whole customer list". It is one narrow, legal
 * and — as it happens — the most valuable case:
 *
 *   Somebody asked about a service today, got an answer, and went quiet
 *   without booking. They are still inside the 24-hour window. One nudge
 *   brings a real share of them back.
 *
 * Anything older than the window is not this feature's business; it belongs to
 * SMS/email win-back, which the customer agreed to separately.
 *
 * WHAT MAKES A NUDGE RIGHT
 *
 * Six conditions, all of them, and each one exists because ignoring it
 * produces a specific complaint:
 *
 *   1. Inside the 24-hour window, with a safety margin — a message that
 *      arrives as the door shuts is a failed send and a confused log.
 *   2. Quiet long enough to be quiet, not mid-typing.
 *   3. WE spoke last. If the customer spoke last, the bot owes them a REPLY,
 *      not a nudge; nudging there means the reply failed and we are papering
 *      over it.
 *   4. No booking came out of this conversation. Nudging someone who already
 *      booked reads as "you were not listening".
 *   5. A human has not taken the thread. A nudge over a salesperson's shoulder
 *      is the same bug thread-ownership.ts was written to stop.
 *   6. Inside the salon's own opening hours, and at most once or twice. A
 *      2am "are you still there?" is how a Page gets reported.
 */

/** Meta's window, mirrored from human-agent.ts so this file stands alone in tests. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Stop this far before the window shuts. A send takes a moment, the sweep runs
 * on a timer, and clocks disagree; aiming at the last minute means some nudges
 * land after the door is closed and come back as errors.
 */
export const WINDOW_MARGIN_MS = 60 * 60 * 1000;

export interface FollowUpSettings {
  /** Off unless the salon turned it on. Nothing here happens by default. */
  enabled: boolean;
  /** How long a thread must be quiet before the first nudge. */
  firstAfterMin: number;
  /** How long after the first nudge before the second. 0 = never send a second. */
  secondAfterMin: number;
  /** Never more than this many nudges in one window. */
  maxPerWindow: number;
  /** Salon-local hours a nudge may be sent in, inclusive start, exclusive end. */
  hourFrom: number;
  hourTo: number;
  /**
   * The salon's OWN wording for the reminder, one line per language. Empty =
   * the built-in lines below. The owner edits it from the "Sửa" button under
   * a nudge in the Inbox, or in the follow-up settings — a nudge is a fixed
   * line, not a model reply, so the AI's instructions never reached it.
   */
  messageVi: string;
  messageEn: string;
}

/** Longest custom nudge. One short line reopens a door; a paragraph reads as an ad. */
export const NUDGE_MAX_CHARS = 300;

export const DEFAULT_FOLLOWUP: FollowUpSettings = {
  enabled: false,
  firstAfterMin: 45,
  secondAfterMin: 0,
  maxPerWindow: 1,
  hourFrom: 9,
  hourTo: 20,
  messageVi: '',
  messageEn: '',
};

/** One clean line of salon text: no control characters, collapsed spaces, capped. */
export function cleanNudgeText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, NUDGE_MAX_CHARS);
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/** Stored settings, validated. Junk reads as the defaults, never as "on". */
export function cleanFollowUp(raw: unknown): FollowUpSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hourFrom = clampInt(o.hourFrom, 0, 23, DEFAULT_FOLLOWUP.hourFrom);
  const hourTo = clampInt(o.hourTo, 1, 24, DEFAULT_FOLLOWUP.hourTo);
  return {
    enabled: o.enabled === true,
    // Never less than ten minutes: below that it is not a follow-up, it is
    // interrupting somebody who is still reading the last message.
    firstAfterMin: clampInt(o.firstAfterMin, 10, 12 * 60, DEFAULT_FOLLOWUP.firstAfterMin),
    secondAfterMin: clampInt(o.secondAfterMin, 0, 12 * 60, DEFAULT_FOLLOWUP.secondAfterMin),
    maxPerWindow: clampInt(o.maxPerWindow, 0, 2, DEFAULT_FOLLOWUP.maxPerWindow),
    hourFrom,
    // An empty or inverted range would mean "never", which reads as a bug
    // rather than a setting. Fall back to the default evening.
    hourTo: hourTo > hourFrom ? hourTo : DEFAULT_FOLLOWUP.hourTo,
    messageVi: cleanNudgeText(o.messageVi),
    messageEn: cleanNudgeText(o.messageEn),
  };
}

export interface ThreadState {
  /** When the customer last wrote. Null = unknown, which is never nudged. */
  lastCustomerAt: Date | string | null;
  /** When we last wrote — bot or human. Null = we never answered. */
  lastOutboundAt: Date | string | null;
  /** Nudges already sent in THIS window, and when the last one went. */
  nudges: number;
  lastNudgeAt: Date | string | null;
  /** True when this conversation produced a booking. */
  booked: boolean;
  /** From thread-ownership: false when a person has the floor. */
  botMaySpeak: boolean;
  /** The customer asked to be left alone. Absolute. */
  optedOut: boolean;
  /**
   * The conversation already ENDED politely: the customer said no thanks /
   * goodbye, or the bot itself signed off. A "still there?" after "thanks,
   * have a great day" reads as not listening. Optional for older callers.
   */
  closed?: boolean;
}

export type Skip =
  | 'off' | 'no-inbound' | 'window-closed' | 'too-soon' | 'customer-spoke-last'
  | 'booked' | 'human' | 'opted-out' | 'closed' | 'enough' | 'quiet-hours';

export type Decision = { send: true; nth: number } | { send: false; why: Skip };

const ms = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Should this thread get a nudge right now?
 *
 * The order of the checks is the order of the reasons, cheapest and most
 * absolute first, so the answer a person reads names the real cause rather
 * than the first rule that happened to fire.
 */
export function decideFollowUp(
  t: ThreadState,
  s: FollowUpSettings,
  now: Date,
  /** The hour at the SALON, 0-23 — not the server's hour. */
  salonHour: number,
): Decision {
  if (!s.enabled || s.maxPerWindow < 1) return { send: false, why: 'off' };
  if (t.optedOut) return { send: false, why: 'opted-out' };
  if (t.closed) return { send: false, why: 'closed' };
  if (t.booked) return { send: false, why: 'booked' };
  if (!t.botMaySpeak) return { send: false, why: 'human' };

  const inbound = ms(t.lastCustomerAt);
  if (inbound === null) return { send: false, why: 'no-inbound' };

  const age = now.getTime() - inbound;
  // Outside the window — or close enough to its edge that a send might miss it.
  if (age >= WINDOW_MS - WINDOW_MARGIN_MS) return { send: false, why: 'window-closed' };

  const out = ms(t.lastOutboundAt);
  // The customer has the last word: they are owed an answer, not a nudge.
  if (out === null || out <= inbound) return { send: false, why: 'customer-spoke-last' };

  if (t.nudges >= s.maxPerWindow) return { send: false, why: 'enough' };

  // The clock starts from the last thing said in the thread — ours or theirs.
  // Measuring from the customer's message would fire the moment we finished
  // answering a long conversation.
  const lastNudge = ms(t.lastNudgeAt);
  const since = now.getTime() - Math.max(out, lastNudge ?? 0);
  const waitMin = t.nudges === 0 ? s.firstAfterMin : s.secondAfterMin;
  if (waitMin <= 0) return { send: false, why: 'enough' };
  if (since < waitMin * 60_000) return { send: false, why: 'too-soon' };

  // Last, because it is the only one that becomes true again by itself: a
  // thread held back at 2am is sent at 9.
  if (salonHour < s.hourFrom || salonHour >= s.hourTo) return { send: false, why: 'quiet-hours' };

  return { send: true, nth: t.nudges + 1 };
}

/**
 * The customer asking to be left alone, in either language. Checked on every
 * inbound message, not only on a nudge — somebody who says "stop" mid-chat
 * means it for the nudges too.
 */
/**
 * Phrases only. A bare "dừng" or "hủy" is not enough: "bàn dừng lại ở đó" and
 * "hủy lịch thứ Ba" are ordinary sentences, and reading either as "never
 * message me again" silently loses a customer nobody knows was lost. Every
 * pattern here names the MESSAGING, which is the thing being refused.
 */
const OPT_OUT_PHRASES = [
  /đừng\s+(?:nhắn|gửi|làm phiền)/i,
  /(?:không|khong|ko)\s+(?:nhắn|nhan|gửi|gui)\s+(?:nữa|nua|cho\s+(?:tôi|toi|em|mình|minh))/i,
  /(?:ngừng|ngung|dừng|dung)\s+(?:nhắn|nhan|gửi|gui|tin)/i,
  /(?:huỷ|hủy|huy)\s+(?:nhận|nhan)\s+(?:tin|thông báo|thong bao)/i,
  /\b(?:unsubscribe|opt\s*out)\b/i,
  /(?:stop|don'?t)\s+(?:messag|text|contact|writ)/i,
  /leave me alone/i,
];

/** A message that is nothing BUT the word — "STOP" on its own line is the convention. */
const OPT_OUT_ALONE = /^(?:stop|unsubscribe|huỷ|hủy|huy)[.!]?$/i;

export function saysStop(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (OPT_OUT_ALONE.test(t)) return true;
  return OPT_OUT_PHRASES.some((re) => re.test(t));
}

/**
 * THE CUSTOMER ENDED IT — not "stop messaging me", just a polite close.
 *
 * Read from the customer's LAST message only: someone who said "no thanks"
 * an hour ago and then asked a price has reopened the door. Short messages
 * only (a long one carries a question or a plan, and the bot answered it).
 */
const CLOSE_PHRASES = [
  // English: a no, a sign-off, or "I will be in touch".
  /\b(?:no|nah|nope),?\s*(?:thanks|thank you|thx|ty)\b/i,
  /\bnot\s+(?:interested|now|today|right now|ready|for me|this time)\b/i,
  /\b(?:maybe|perhaps)\s+(?:later|next time|another time|some other time)\b/i,
  /\b(?:i['’]?ll|i will|let me)\s+(?:pass|think about it|let you know|get back to you|call (?:you|the salon)|check (?:my|with)|(?:just\s+)?(?:walk|come|stop|drop) (?:in|by))\b/i,
  // "I'm good" as the whole answer — not "I'm good with 3pm".
  /\b(?:i['’]?m|i am|we['’]?re)\s+(?:good|all set|fine|ok(?:ay)?)(?:\s*,?\s*(?:thanks|thank you|thx|for now|then))?[\s.!]*$/i,
  /\b(?:never\s*mind|nvm|forget it|that['’]?s all|that is all|all good)\b/i,
  /\bhave\s+a\s+(?:great|good|nice|wonderful|lovely|blessed)\s+(?:day|one|night|evening|weekend|week)\b/i,
  /\b(?:good\s*bye|bye(?:\s*bye)?|take care|see ya|cya)\b/i,
  // Vietnamese.
  /(?:không|khong|ko|k)\s+(?:cần|can|có nhu cầu|co nhu cau|đặt|dat|làm|lam)(?:\s+(?:đâu|dau|nữa|nua|ạ|a|nha|nhé|nhe|em|shop|chị|chi|anh|ạ))*\s*[.!]*$/i,
  /^(?:thôi|thoi)\b|\b(?:thôi|thoi)\s+(?:ạ|a|nha|nhé|nhe|em|khỏi|khoi|để sau|de sau)\b/i,
  /\b(?:khỏi|khoi)\s*(?:ạ|a|nha|nhé|nhe|em)?\s*$/i,
  /(?:để|de)\s+(?:lần|lan|dịp|dip|hôm|hom|bữa|bua)\s+(?:sau|khác|khac)|(?:để|de)\s+sau|lúc khác|luc khac|hẹn (?:dịp|lần|hôm) khác/i,
  /(?:để|de)\s+(?:em|chị|chi|anh|mình|minh|tôi|toi|tui)\s+(?:suy nghĩ|suy nghi|tính|tinh|xem lại|xem lai|báo sau|bao sau|sắp xếp|sap xep)/i,
  /(?:chào|chao)\s+(?:em|shop|bạn|ban|nha|nhé|nhe)\s*[.!]*$|tạm biệt|tam biet|hẹn gặp lại|hen gap lai/i,
];

/** A message that is ONLY thanks / ok / no — a sign-off, not a question. */
const CLOSE_ALONE = /^(?:(?:ok(?:ay)?|okie|oke|vâng|vang|dạ|da|ừ|uh|yes|alright|great|cool|perfect|got it|noted)[\s,.!]*)?(?:thanks?(?: you)?(?: so much| a lot| very much)?|thank u|thx|tks|ty|cảm ơn|cám ơn|cam on|camon)(?:\s+(?:em|shop|bạn|ban|nhiều|nhieu|nha|nhé|nhe|ạ|a|chị|chi|anh))*[\s.!😊🙏❤️]*$|^(?:no|nope|nah|không|khong|ko|k)[\s.!]*$/i;

export function customerClosed(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > 160) return false;
  // A question is not a goodbye: "no thanks — how much is a gel fill?".
  if (/\?/.test(t)) return false;
  if (CLOSE_ALONE.test(t)) return true;
  return CLOSE_PHRASES.some((re) => re.test(t));
}

/** The bot already said goodbye. A nudge after its own sign-off contradicts it. */
const BOT_SIGNOFF = [
  /\bhave\s+a\s+(?:great|good|nice|wonderful|lovely|beautiful)\s+(?:day|one|night|evening|weekend|week)\b/i,
  /\b(?:take care|good\s*bye|bye for now)\b/i,
  /\b(?:feel free to|just)\s+(?:reach out|message|text|let (?:us|me) know)\b.{0,40}\b(?:any ?time|whenever|when you(?:'re| are)? ready)\b/i,
  /chúc\s+(?:anh|chị|anh\/chị|a\/c|bạn|mình|quý khách)?\s*(?:một\s+)?(?:ngày|buổi|cuối tuần|tuần)/i,
  /hẹn gặp lại|tạm biệt|khi nào (?:cần|rảnh).{0,30}(?:nhắn|liên hệ)/i,
];

export function botSignedOff(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  // The bot asking something keeps the door open on purpose ("…have a great day! Anything else?").
  if (/\?\s*$/.test(t)) return false;
  return BOT_SIGNOFF.some((re) => re.test(t));
}

/**
 * What a nudge says when no model writes it.
 *
 * Templates first, on purpose. A nudge is one short line whose job is to
 * reopen a door, and a thousand of them a day written by a model is a real
 * bill for a sentence that barely varies. The salon may turn the model on for
 * this (`aiWrites`), and then it costs what a reply costs.
 *
 * Every line ends by asking something answerable, and none of them pretends to
 * be a person checking back — the bot does not claim to be human anywhere else
 * either.
 */
// "anh/chị", never "chị": nothing in a quiet thread says which the customer
// is, and the booking prompt forbids guessing for the same reason.
export const NUDGE_TEMPLATES: { vi: string; en: string }[] = [
  {
    vi: 'Dạ anh/chị ơi, mình còn cần em giữ khung giờ nào không ạ? Em xem lịch rồi báo anh/chị ngay.',
    en: 'Still want me to hold a time for you? Tell me roughly when and I will check the book.',
  },
  {
    vi: 'Dạ em vẫn đây ạ — anh/chị cần em báo giá dịch vụ nào hay xem giờ trống hôm nào thì nhắn em nhé.',
    en: 'I am still here — say the word if you want a price or the open times for a day.',
  },
];

/**
 * The nudge that fits WHERE the customer stopped.
 *
 * A generic "still there?" to someone who was one phone number away from a
 * booking wastes the nudge. The last thing the bot asked decides the line:
 * waiting on a yes to the recap → ask for the yes; missing name/phone → ask
 * for them; a time question → offer to check the book; otherwise general.
 */
export type NudgeKind = 'confirm' | 'contact' | 'time' | 'general';

export function nudgeKindFor(lastBotText: string | null | undefined): NudgeKind {
  const t = String(lastBotText ?? '');
  if (/(shall i book|should i book|want me to book|book it\?|is that right\?|đặt lịch luôn|em đặt luôn|chốt lịch|xác nhận lại)/i.test(t)) return 'confirm';
  if (/(first name|your name|phone|number|tên|số điện thoại|sđt|sdt)/i.test(t)) return 'contact';
  if (/(when|what time|which day|what day|which time|suits you|works for you|giờ nào|hôm nào|ngày nào|mấy giờ|khung giờ)/i.test(t)) return 'time';
  return 'general';
}

/** Lines compared without case, spacing or trailing punctuation/emoji. */
const sameLine = (a: string) => a.toLowerCase().replace(/[\s.!😊🙏]+/gu, ' ').trim();

export interface NudgeOpts {
  /** The salon's own lines (FollowUpSettings.messageVi / messageEn). */
  custom?: { vi?: string | null; en?: string | null } | null;
  /** Every nudge already sent in this thread — none of them is said twice. */
  sent?: string[];
}

/**
 * The nudge for the nth follow-up — or null when every line that fits has
 * already been sent in this thread (the customer would read the same sentence
 * twice, which is exactly what made the bot look broken).
 *
 * The salon's own line comes first wherever the built-in line is generic; the
 * two specific asks (confirm the recap, send name + phone) keep their wording
 * because they ask for one concrete thing.
 */
export function contextualNudge(lastBotText: string | null | undefined, vi: boolean, nth = 1, opts: NudgeOpts = {}): string | null {
  const kind = nth > 1 ? 'general' : nudgeKindFor(lastBotText);
  const custom = cleanNudgeText(vi ? opts.custom?.vi : opts.custom?.en);
  const time = vi ? NUDGE_TEMPLATES[0].vi : NUDGE_TEMPLATES[0].en;
  const general = vi ? NUDGE_TEMPLATES[1].vi : NUDGE_TEMPLATES[1].en;
  const confirm = vi
    ? 'Dạ anh/chị ơi, em đặt lịch như trên cho mình luôn nhé? Anh/chị chỉ cần trả lời "ok" là xong ạ 😊'
    : 'Still want me to book that for you? Just reply "yes" and it is done 😊';
  const contact = vi
    ? 'Dạ anh/chị ơi, anh/chị gửi em tên và số điện thoại là em giữ lịch cho mình liền nhé 😊'
    : 'Just checking in — send me your name and phone number and I will get your appointment set up 😊';
  const order: string[] =
    kind === 'confirm' ? [confirm, custom, general, time]
      : kind === 'contact' ? [contact, custom, general, time]
        : kind === 'time' ? [custom, time, general]
          : [custom, general, time];
  const said = new Set((opts.sent ?? []).map((x) => sameLine(String(x ?? ''))));
  return order.find((line) => line && !said.has(sameLine(line))) ?? null;
}

/** Every built-in nudge line, both languages — lets the Inbox mark a nudge Meta sent back without our flag. */
let builtIn: string[] | null = null;
export function builtInNudgeLines(): string[] {
  if (builtIn) return builtIn;
  const out: string[] = [];
  for (const k of ['confirm', 'contact', 'time', 'general'] as const) {
    const ask = k === 'confirm' ? 'shall i book it?' : k === 'contact' ? 'your phone' : k === 'time' ? 'what time' : '';
    for (const v of [true, false]) { const l = contextualNudge(ask, v, 1); if (l) out.push(l); }
  }
  builtIn = [...new Set(out)];
  return builtIn;
}

/** Is this bot line one of the salon's reminders (built-in or its own)? */
export function isNudgeLine(text: string | null | undefined, custom?: { vi?: string | null; en?: string | null } | null): boolean {
  const t = sameLine(String(text ?? ''));
  if (!t) return false;
  const lines = [...builtInNudgeLines(), cleanNudgeText(custom?.vi), cleanNudgeText(custom?.en)].filter(Boolean);
  return lines.some((l) => sameLine(l) === t);
}

/** Where each salon's choice is stored (settings table, one row per tenant). */
export const CHAT_FOLLOWUP_KEY = 'chat_followup';

/**
 * A salon's stored settings, validated. Nothing stored = DEFAULT_FOLLOWUP,
 * which is OFF: messages to a salon's customers go out only once that salon
 * has switched this on for itself.
 */
export function followUpSettingsFrom(raw: unknown): FollowUpSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FOLLOWUP };
  return cleanFollowUp({ ...DEFAULT_FOLLOWUP, ...(raw as Record<string, unknown>) });
}

/** One turn as the thread stores it — only what the follow-up reads. */
export interface StoredTurn {
  role: 'user' | 'assistant';
  content?: unknown;
  at?: string | null;
  manual?: boolean;
  nudge?: boolean;
}

/**
 * The thread's state for decideFollowUp, read from its own history (no new
 * columns). Nudges are turns marked `nudge`, counted only since the
 * customer's last message — a reply opens a new allowance.
 */
export function threadStateFrom(o: {
  history: StoredTurn[];
  lastCustomerAt: Date | string | null;
  lastMessageAt: Date | string | null;
  handoff: boolean;
  assigned: boolean;
  booked: boolean;
}): ThreadState & { lastBotText: string | null; sentNudges: string[] } {
  const h = Array.isArray(o.history) ? o.history.filter(Boolean) : [];
  const inbound = ms(o.lastCustomerAt);
  const last = h[h.length - 1];
  const bots = h.filter((t) => t.role === 'assistant');
  // What the customer was last ASKED — the nudges themselves do not count.
  const lastAsk = [...bots].reverse().find((t) => !t.nudge);
  const lastUser = [...h].reverse().find((t) => t.role === 'user');
  const lastBot = bots[bots.length - 1];
  const lastBotAt = ms(lastBot?.at ?? null);
  // A bot turn written without a clock: the thread's own last-message stamp
  // stands in, but only when that turn IS the last thing in the thread.
  const outbound = lastBotAt ?? (last?.role === 'assistant' ? ms(o.lastMessageAt) : null);
  const since = inbound ?? 0;
  const nudges = bots.filter((t) => t.nudge && (ms(t.at ?? null) ?? 0) >= since);
  const lastNudge = nudges[nudges.length - 1];
  return {
    lastCustomerAt: o.lastCustomerAt,
    // The customer wrote last in our buffer → they are owed a reply, not a nudge.
    lastOutboundAt: last?.role === 'user' ? null : (outbound !== null ? new Date(outbound) : null),
    nudges: nudges.length,
    lastNudgeAt: lastNudge?.at ?? null,
    booked: o.booked,
    // A person has the floor — taken over, assigned, or the salon's last
    // word was typed by a human. The bot does not nudge over them.
    botMaySpeak: !o.handoff && !o.assigned && !(lastBot?.manual),
    optedOut: h.some((t) => t.role === 'user' && saysStop(String(t.content ?? ''))),
    // Ended politely: the customer's LAST words were a no-thanks / goodbye, or
    // the bot's last real reply (not a nudge) signed off.
    closed: customerClosed(lastUser ? String(lastUser.content ?? '') : null) || botSignedOff(lastAsk ? String(lastAsk.content ?? '') : null),
    lastBotText: lastAsk ? String(lastAsk.content ?? '') : null,
    // All nudges in the buffer, any window: the same sentence is never sent twice.
    sentNudges: bots.filter((t) => t.nudge).map((t) => String(t.content ?? '')),
  };
}

/** One line, chosen so the same customer does not get the same sentence twice. */
export function nudgeText(nth: number, vi: boolean): string {
  const t = NUDGE_TEMPLATES[Math.min(Math.max(1, nth), NUDGE_TEMPLATES.length) - 1];
  return vi ? t.vi : t.en;
}

/** Everything the screen needs to explain a skip in the salon's own words. */
export const SKIP_LABEL: Record<Skip, { vi: string; en: string }> = {
  'off': { vi: 'Tính năng đang tắt', en: 'Turned off' },
  'no-inbound': { vi: 'Chưa biết khách nhắn lúc nào', en: 'No inbound time on record' },
  'window-closed': { vi: 'Quá 24h — Meta không cho bot nhắn nữa', en: 'Past 24h — Meta does not allow the bot to write' },
  'too-soon': { vi: 'Chưa đủ lâu', en: 'Not quiet long enough yet' },
  'customer-spoke-last': { vi: 'Khách đang chờ mình trả lời', en: 'The customer is waiting for an answer' },
  'booked': { vi: 'Khách đã đặt lịch rồi', en: 'Already booked' },
  'human': { vi: 'Nhân viên đang cầm hội thoại', en: 'A person has the thread' },
  'opted-out': { vi: 'Khách xin đừng nhắn nữa', en: 'The customer asked us to stop' },
  'closed': { vi: 'Khách đã cảm ơn / từ chối / chào — không nhắn thêm', en: 'The customer said no thanks or goodbye' },
  'enough': { vi: 'Đã nhắn đủ số lần', en: 'Already nudged enough' },
  'quiet-hours': { vi: 'Ngoài giờ mở cửa', en: 'Outside opening hours' },
};
