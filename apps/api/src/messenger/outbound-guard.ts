/**
 * THE LAST DOOR BEFORE A CUSTOMER READS ANYTHING THE BOT WROTE.
 *
 * Why it exists (Amy's Lash and Brows, 6–7 Nov 2026):
 *
 *   - The owner told the AI "never say 'Let me double-check with the salon'".
 *     The AI obeyed — and the SYSTEM sent that exact sentence anyway: it was the
 *     built-in fallback for "the AI broke an instruction twice". Nothing ever
 *     checked the fallback against the owner's own rules.
 *   - A customer wrote "No thx". The owner had taught "when the customer
 *     declines, say nothing". With nothing compliant to send, the same fallback
 *     path sent the owner's NOTE itself — an internal instruction, word for
 *     word, to the customer.
 *
 * Both were sentences no model wrote at that moment, so no model-side rule
 * could stop them. This file is plain code that every outgoing bot line passes
 * through, whoever produced it (the model, a fallback, a template, a
 * reminder): a line that says what the owner forbade, or that reads like an
 * instruction to the bot rather than a message to a customer, is not sent.
 * Silence plus a note to the staff is always better than either.
 *
 * Pure functions, no I/O: the rules are the part worth testing.
 */

/** The bot decided to say nothing (a reply that is this string is never sent). */
export const SILENT = '\u0000__lumio_silent__';

export function isSilent(reply: string | null | undefined): boolean {
  return reply === SILENT || reply === '\u0000__lumio_held__';
}

/** The owner's instruction, as much of it as this file needs. */
export interface GuardInstruction {
  kind: string;
  text: string;
  mode?: string;
  meaning?: string | null;
  on?: boolean;
}

/** Lower case, accents kept, punctuation and spacing flattened — "Let me double-check…" ≈ "let me double check". */
export function flat(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUOTED = /["“”„«»]([^"“”„«»]{6,200})["“”„«»]|(?:^|[\s(:])'([^']{6,200})'(?=$|[\s).,!?;:])/g;

/**
 * The exact sentences the owner forbade: every quoted phrase in a NEVER
 * instruction (their words and the meaning written for the model).
 * "Đừng nói 'Let me double-check with the salon'" → "let me double check with the salon".
 */
export function forbiddenPhrases(list: GuardInstruction[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const i of list ?? []) {
    if (!i || i.on === false || i.kind !== 'never') continue;
    for (const src of [i.text, i.meaning ?? '']) {
      for (const m of String(src ?? '').matchAll(QUOTED)) {
        const p = flat(m[1] ?? m[2]);
        // A quoted phrase of one or two words ("bot", "ok") would block half
        // the language; the owner forbids sentences, not words.
        if (p.split(' ').length >= 3) out.add(p);
      }
    }
  }
  return [...out];
}

/** Does the line say (or start to say) a forbidden sentence? */
export function saysForbidden(text: string, phrases: string[]): string | null {
  const t = flat(text);
  if (!t) return null;
  for (const p of phrases) {
    if (!p) continue;
    if (t.includes(p)) return p;
    // "Let me double-check that with the salon" still says it: the phrase's
    // words, in order, with at most two extra words between each.
    const words = p.split(' ');
    if (words.length >= 4) {
      const re = new RegExp(`(?:^|\\s)${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\s+\\S+){0,2}\\s+')}(?:\\s|$)`, 'u');
      if (re.test(t)) return p;
    }
  }
  return null;
}

/**
 * Words that only ever appear when somebody is talking ABOUT the bot or TO the
 * bot — in an instruction, a correction, a system note — and never in a
 * message a receptionist writes to a customer.
 */
const INTERNAL_MARKERS: RegExp[] = [
  /\bsystem correction\b/i,
  /\b(?:owner|salon owner)['’]?s? instructions?\b/i,
  /\[(?:[AWN]\d{1,3}|[A-Z]\d{1,3})\]/,
  /(?:^|\n)\s*(?:NEVER|ALWAYS|ANSWER)\s*:/,
  /\b(?:the|this) (?:ai|bot|assistant|model)\s+(?:should|must|will|shall|needs? to|has to|is to)\b/i,
  /\b(?:do not|don['’]t|never)\s+(?:reply|respond|answer)\s+(?:to\s+)?(?:the\s+)?(?:customer|client|them|when|if)\b/i,
  /\b(?:stay|remain|be|keep)\s+(?:completely\s+)?silent\b/i,
  /\bwhen (?:the )?(?:customer|client) (?:says|writes|replies|declines|asks)\b/i,
  /\b(?:ai|bot|trợ lý)\s+(?:phải|sẽ|không được|đừng|cần)\b/i,
  /\b(?:khi|nếu)\s+khách\s+(?:nói|nhắn|trả lời|từ chối|hỏi)\b/i,
  /(?:^|\s)(?:không trả lời khách|không rep khách)(?:\s|$|[.,!])/i,
  /(?:hướng dẫn nội bộ|ghi chú nội bộ|lời dặn của chủ tiệm)/i,
];

/** Does this text read like a note to the bot (an instruction), not a line for a customer? */
export function looksLikeNote(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  return INTERNAL_MARKERS.some((re) => re.test(t));
}

/** The words an instruction uses when it talks to the bot about the customer. */
const NOTE_CUES = /\b(?:customers?|clients?|khách|reply|replies|respond|answer|trả lời|rep|say|nói|tell|ai|bot|assistant|message|nhắn)\b/i;

/** Content words of a sentence (3+ letters), for overlap. */
function words(s: string): string[] {
  return flat(s).split(' ').filter((w) => w.length >= 3);
}

/**
 * Does this line read like an instruction to the bot rather than a message to
 * a customer — a marker above, or most of one of the owner's own notes?
 * Returns why, or null.
 */
export function readsInternal(text: string, list?: GuardInstruction[] | null): string | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  for (const re of INTERNAL_MARKERS) if (re.test(t)) return `marker ${re.source.slice(0, 40)}`;
  const mine = new Set(words(t));
  if (mine.size < 4) return null;
  for (const i of list ?? []) {
    if (!i || i.on === false) continue;
    // A word-for-word ANSWER is written FOR the customer: sending it is the point.
    if (i.kind === 'answer' && i.mode === 'verbatim') continue;
    for (const src of [i.text, i.meaning ?? '']) {
      // Only a note that talks to the bot is "internal". An answer's fact
      // ("No first-visit discount right now") repeated to a customer is the
      // job; a rule about customers repeated to a customer is the leak.
      const isNote = looksLikeNote(src) || ((i.kind === 'never' || i.kind === 'always' || src === i.meaning) && NOTE_CUES.test(src));
      if (!isNote) continue;
      const theirs = [...new Set(words(src))];
      if (theirs.length < 6) continue;
      const shared = theirs.filter((w) => mine.has(w)).length;
      // Most of the note is in the line: the line IS the note.
      if (shared / theirs.length >= 0.7) return 'owner note';
    }
  }
  return null;
}

export interface OutboundVerdict {
  ok: boolean;
  /** Why it was held back (for the log and the staff note). */
  why?: string;
}

/** The one check every outgoing bot line passes. */
export function outboundVerdict(text: string, list?: GuardInstruction[] | null): OutboundVerdict {
  if (text === SILENT) return { ok: false, why: 'silent' };
  if (isSilent(text)) return { ok: false, why: 'no compliant reply' };
  if (isNoReply(text)) return { ok: false, why: 'silent' };
  const f = saysForbidden(text, forbiddenPhrases(list));
  if (f) return { ok: false, why: `forbidden phrase "${f}"` };
  const internal = readsInternal(text, list);
  if (internal) return { ok: false, why: `internal text (${internal})` };
  return { ok: true };
}

/**
 * A customer closing the conversation — "no thanks", "ok thank you", a thumbs
 * up — needs no answer, and every answer to it reads as a bot that cannot
 * stop talking. Only short messages count: "no thanks, but what about Sunday?"
 * is a question.
 */
const CLOSERS_EN = /^(?:no+|nope|nah|no thanks?|no thank you|no thx|nothx|no ty|not now|not right now|not interested|i'?m good|im good|im ok|nah thanks?|i'?m ok|all good|that'?s all|that'?s it|nothing else|thanks?|thank you|thank u|thanks so much|thank you so much|thx|tks|ty|tysm|ok(?:ay)?|ok(?:ay)? thanks?|ok(?:ay)? thank you|ok(?:ay)? thx|ok(?:ay)? ty|k|kk|great thanks?|perfect thanks?|sounds good|got it|cool|bye|goodbye|see you|see ya|have a good (?:day|one|night))$/;
const CLOSERS_VI = /^(?:không(?: cần)?(?: đâu)?(?: ạ| em| nhé)?|ko(?: cần)?|k cần|thôi(?: ạ| em)?|dạ thôi(?: ạ)?|thôi không cần|dạ không|không ạ|cảm ơn(?: em| bạn| nhé| nha| ạ)?|cám ơn(?: em| bạn| nhé| nha| ạ)?|cảm ơn em nhé|cám ơn em nhé|thanks em|tks em|ok em|ok(?: ạ| nhé| nha)?|dạ|vâng|vâng ạ|dạ ok|được rồi|oke|okie|okela|bye|tạm biệt)$/;

export function isCloser(text: string | null | undefined): boolean {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  // Emoji / sticker-only: a thumbs-up, a heart, a smile.
  if (/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u.test(raw) && /\p{Extended_Pictographic}/u.test(raw)) return true;
  if (raw.length > 40 || /\?/.test(raw)) return false;
  const t = flat(raw).replace(/\s*(?:😊|🙏|❤️|👍)+$/u, '').trim();
  return CLOSERS_EN.test(t) || CLOSERS_VI.test(t);
}

/**
 * Should the bot stay quiet on this closer? A decline ("no thanks") always —
 * the customer said no. A plain thanks / ok only when the bot was not waiting
 * for an answer: "ok" to "Shall I book 2pm?" is a yes, not a goodbye.
 */
export function silentOnCloser(customer: string | null | undefined, lastBotText: string | null | undefined): boolean {
  if (!isCloser(customer)) return false;
  const t = flat(customer);
  // An explicit "no, thanks" — not a bare "no", which can answer a question
  // ("Any time in mind?" — "no").
  const decline = /^(?:no thanks?|no thank you|no thx|nothx|no ty|nah thanks?|not interested|i'?m good|im good|không cần(?: đâu)?(?: ạ| em| nhé)?|ko cần|k cần|thôi(?: ạ| em)?|dạ thôi(?: ạ)?|thôi không cần)$/.test(t);
  if (decline) return true;
  const asked = /\?\s*(?:[\p{Extended_Pictographic}️\s]*)$/u.test(String(lastBotText ?? '').trim());
  return !asked;
}

/**
 * Nothing compliant was left to say (the owner's instructions blocked every
 * draft): the reply is held back and the staff are told. Never sent.
 */
export const HELD = '\u0000__lumio_held__';

/** What the model writes when the customer's message needs no answer. */
export const NO_REPLY_TOKEN = '[NO_REPLY]';

/** The model chose silence: the token alone, or a reply that is only the token. */
export function isNoReply(text: string | null | undefined): boolean {
  return /^\s*\[?\s*no[_ ]reply\s*\]?\s*\.?\s*$/i.test(String(text ?? ''));
}

/** Told to the model on every turn: silence is an allowed answer. */
export const NO_REPLY_RULE = `\nWHEN TO SAY NOTHING: if the customer's latest message needs no answer — they declined ("no thanks", "không cần đâu"), said goodbye, or only thanked you after everything was already settled — or the salon owner's instructions say not to reply in this situation, answer with exactly ${NO_REPLY_TOKEN} and nothing else. Never write an instruction, a rule or a note about the conversation as your reply; everything you write is sent to the customer.`;

/**
 * A reply that is mostly fine but has one forbidden or internal sentence:
 * that sentence goes, the rest is sent. Null when nothing worth sending is
 * left (then the whole reply is held for a person).
 */
export function withoutBadSentences(text: string, list?: GuardInstruction[] | null): string | null {
  const t = String(text ?? '').trim();
  if (!t || isSilent(t) || isNoReply(t)) return null;
  const banned = forbiddenPhrases(list);
  // Sentences, keeping their own punctuation and line breaks.
  const parts = t.match(/[^.!?\n]+(?:[.!?]+|\n+|$)\s*/g) ?? [t];
  const kept = parts.filter((p) => p.trim() && !saysForbidden(p, banned) && !readsInternal(p, list));
  if (kept.length === parts.length) return t;
  const out = kept.join('').trim();
  // Nothing left, or only a scrap ("Sure!"): better a person answers.
  if (out.replace(/[\p{P}\p{S}\s]/gu, '').length < 12) return null;
  return outboundVerdict(out, list).ok ? out : null;
}
