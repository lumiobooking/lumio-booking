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
}

export const DEFAULT_FOLLOWUP: FollowUpSettings = {
  enabled: false,
  firstAfterMin: 45,
  secondAfterMin: 0,
  maxPerWindow: 1,
  hourFrom: 9,
  hourTo: 20,
};

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
}

export type Skip =
  | 'off' | 'no-inbound' | 'window-closed' | 'too-soon' | 'customer-spoke-last'
  | 'booked' | 'human' | 'opted-out' | 'enough' | 'quiet-hours';

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
export const NUDGE_TEMPLATES: { vi: string; en: string }[] = [
  {
    vi: 'Dạ chị ơi, mình còn cần em giữ khung giờ nào không ạ? Em xem lịch rồi báo chị ngay.',
    en: 'Still want me to hold a time for you? Tell me roughly when and I will check the book.',
  },
  {
    vi: 'Dạ em vẫn đây ạ — chị cần em báo giá dịch vụ nào hay xem giờ trống hôm nào thì nhắn em nhé.',
    en: 'I am still here — say the word if you want a price or the open times for a day.',
  },
];

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
  'enough': { vi: 'Đã nhắn đủ số lần', en: 'Already nudged enough' },
  'quiet-hours': { vi: 'Ngoài giờ mở cửa', en: 'Outside opening hours' },
};
