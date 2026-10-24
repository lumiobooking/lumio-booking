/**
 * THE RULES THAT KEEP A CALL ALIVE, AND THE LANGUAGE A CUSTOMER SPEAKS.
 *
 * The hotline used to hang up whenever the model felt the conversation was
 * over — after "ok", after a question was answered, after its tool budget
 * ran out. These are the only conditions under which the assistant may end
 * a call, written down once and tested.
 *
 * Pure: no database, no clock (tested in brain-rules.spec.ts).
 */
import { isLang, type Lang } from './brain-settings';
import { detectLang as detectViEn, requestedLang } from '../common/reply-language';

// ---------------------------------------------------------------- hanging up

const GOODBYE = [
  /\b(bye|goodbye|good bye|see you|talk (to you )?later|take care|that'?s (all|it)|nothing else|i'?m (good|done|all set)|no,? (thanks|thank you)|all good)\b/i,
  /(tạm biệt|chào (em|chị|anh|nhé)|vậy thôi|thế thôi|không còn gì|hết rồi|cảm ơn (em|nhiều|nhé|ạ)|cám ơn|được rồi (em|ạ)|ok(ay)? (em|ạ) ?(cảm ơn|cám ơn)?$|em ơi thôi)/i,
  /(adiós|hasta luego|eso es todo|nada más|gracias,? (eso es todo|nada más))/i,
];
const NOT_GOODBYE = /\b(but|and also|one more|another|also|wait|actually|can i|could i|what about)\b|(nhưng|còn|với lại|thêm|à mà|khoan|mà em)/i;

/** Did the caller's last words close the conversation? */
export function isGoodbye(text: unknown): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (NOT_GOODBYE.test(s) && s.length > 25) return false;
  return GOODBYE.some((re) => re.test(s));
}

export interface HangupInput {
  /** The model asked to end the call. */
  wantEnd: boolean;
  /** A booking was made on this call (now or earlier). */
  booked: boolean;
  /** The caller's last utterance. */
  lastUser: string;
  /** The model's reply on this turn. */
  reply: string;
}

/**
 * May the call end now? Only when the caller themself closed it — a goodbye,
 * "that's all" — or when a booking is done and they said they need nothing
 * else. The model wanting to end is necessary but never sufficient.
 */
export function mayHangUp(i: HangupInput): boolean {
  if (!i.wantEnd) return false;
  if (isGoodbye(i.lastUser)) return true;
  // A short "no" / "no thanks" right after a booking is "nothing else".
  if (i.booked && /^(no|nope|nah|không|dạ không|ko|k)\b.{0,20}$/i.test(i.lastUser.trim())) return true;
  return false;
}

/** When the model wanted to end but may not: what to say instead, in the call's language. */
export function keepOpenLine(lang: string): string {
  if (/^vi/i.test(lang)) return 'Dạ anh chị còn cần em giúp gì nữa không ạ?';
  return 'Is there anything else I can help you with?';
}

// ---------------------------------------------------------------- the turn's deadline

/** How many "one moment" fillers a slow turn may send before asking the caller to repeat. */
export const MAX_FILLER_HOPS = 3;

/** The next hop number encoded in a pending-turn id, or null when the id is not ours. */
export function parsePendingId(id: string): { base: string; hop: number } | null {
  const m = /^(.+?)(?:~h(\d))?$/.exec(String(id ?? ''));
  if (!m || !m[1]) return null;
  return { base: m[1], hop: Number(m[2] ?? '0') };
}
export function nextPendingId(base: string, hop: number): string { return `${base}~h${hop}`; }

// ---------------------------------------------------------------- language

const RE_HANGUL = /[가-힯ᄀ-ᇿ]/;
const RE_KANA = /[぀-ゟ゠-ヿ]/;
const RE_HAN = /[一-鿿]/;
// Letters only Vietnamese writes (Spanish and French share á é í ó ú with it, so those do not count here).
const RE_VI_STRONG = /[ăâđêôơưạảãẹẻẽịỉĩọỏõụủũỵỷỹầấậẩẫằắặẳẵềếệểễồốộổỗờớợởỡừứựửữ]|\b(chị|anh|em|dạ|ạ|không|được|làm|cho|hỏi|giờ|thứ|lịch|tiệm|mình|nhé|ơi)\b/i;
const RE_ES_WORDS = /\b(hola|gracias|quiero|quisiera|cita|precio|cuánto|cuanto|tienen|tiene|para|mañana|sábado|sabado|domingo|lunes|martes|jueves|viernes|por favor|buenos|buenas|necesito|puedo|reservar|hora|señora|señor|uñas|manicura|pedicura|gel|disponible|hay|sí)\b/i;
const RE_ES_MARKS = /[ñ¿¡]|\b(está|estás|qué|cómo|también|aquí)\b/i;
const RE_FR_WORDS = /\b(bonjour|bonsoir|merci|je voudrais|je veux|rendez-vous|rendez vous|prix|combien|avez-vous|pour|demain|samedi|dimanche|lundi|mardi|jeudi|vendredi|s'il vous plaît|svp|disponible|réserver|une|des|est-ce|vous)\b/i;
const RE_FR_MARKS = /\b(ça|être|c'est|très|où)\b|[àâçéèêëîïôûùüÿœ]/i;

/**
 * One message's language among the ones a salon may serve, or null when the
 * message carries no signal ("ok", "👍", a phone number). Vietnamese and
 * English keep the rules in common/reply-language; the others are read from
 * their script or their everyday words.
 */
export function detectLanguage(text: unknown): Lang | null {
  const raw = String(text ?? '').replace(/\[[^\]]*\]/g, ' ').trim();
  if (!raw) return null;
  // "English", "Spanish please", "tiếng Việt được không": the customer named it.
  const asked = requestedLang(raw);
  if (asked) return asked;
  if (RE_HANGUL.test(raw)) return 'ko';
  if (RE_KANA.test(raw)) return 'ja';
  if (RE_HAN.test(raw)) return 'zh';
  if (RE_VI_STRONG.test(raw)) return 'vi';
  const s = raw.toLowerCase();
  const es = (s.match(RE_ES_WORDS) ?? []).length + (RE_ES_MARKS.test(s) ? 1 : 0);
  const fr = (s.match(RE_FR_WORDS) ?? []).length + (RE_FR_MARKS.test(s) ? 1 : 0);
  if (es >= 2 && es > fr) return 'es';
  if (fr >= 2 && fr > es) return 'fr';
  const viEn = detectViEn(raw);
  if (viEn === 'vi') return 'vi';
  if (viEn === 'en') return 'en';
  if (es === 1 && !/\b(the|is|are|you|for|and|book|please)\b/i.test(s)) return null;
  return null;
}

/**
 * The language of a conversation: every customer message votes, later ones
 * a little more; a tie or no signal → `fallback`. A language the salon does
 * not serve is answered in the salon's primary language.
 */
export function conversationLanguage(customerTexts: readonly unknown[], allowed: Lang[], fallback: Lang): Lang {
  const texts = (customerTexts ?? []).slice(-12);
  const votes = new Map<Lang, number>();
  texts.forEach((t, i) => {
    // A language the customer ASKED for outweighs any number of lines.
    const w = requestedLang(t) ? 100 + i : i >= texts.length - 3 ? 2 : 1;
    const l = detectLanguage(t);
    if (l) votes.set(l, (votes.get(l) ?? 0) + w);
  });
  let best: Lang | null = null, bestN = 0, tie = false;
  for (const [l, n] of votes) {
    if (n > bestN) { best = l; bestN = n; tie = false; } else if (n === bestN) tie = true;
  }
  if (!best || tie) return fallback;
  return allowed.includes(best) ? best : (allowed.includes(fallback) ? fallback : allowed[0] ?? fallback);
}

/** The Twilio speech / TTS code for a brain language (what the hotline can listen in). */
export function voiceLangCode(lang: Lang, market?: string | null): string {
  if (lang === 'vi') return 'vi-VN';
  if (lang === 'es') return 'es-US';
  if (lang === 'fr') return 'fr-FR';
  if (lang === 'ko') return 'ko-KR';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'zh') return 'cmn-Hans-CN';
  return String(market ?? '').toUpperCase() === 'AU' ? 'en-AU' : 'en-US';
}
export function brainLangOfVoice(code: string | null | undefined): Lang {
  const c = String(code ?? '').toLowerCase();
  if (c.startsWith('vi')) return 'vi';
  if (c.startsWith('es')) return 'es';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('ko')) return 'ko';
  if (c.startsWith('ja')) return 'ja';
  if (c.startsWith('zh') || c.startsWith('cmn')) return 'zh';
  return 'en';
}
export const asLang = (x: unknown, d: Lang = 'en'): Lang => (isLang(x) ? x : d);

// ---------------------------------------------------------------- why a conversation ended

export type EndReason =
  | 'goodbye' | 'booked_done' | 'caller_hangup' | 'silence' | 'error' | 'tool_loop' | 'deadline'
  | 'transfer' | 'callback' | 'voicemail' | 'off_hours' | 'in_progress';

export const END_REASON_LABEL: Record<EndReason, { vi: string; en: string }> = {
  goodbye: { vi: 'Khách chào, xong việc', en: 'Customer said goodbye' },
  booked_done: { vi: 'Đặt xong, khách không cần gì thêm', en: 'Booked, nothing else' },
  caller_hangup: { vi: 'Khách cúp máy', en: 'Caller hung up' },
  silence: { vi: 'Im lặng → nhờ gọi lại', en: 'Silence → callback' },
  error: { vi: 'Lỗi hệ thống → nhờ gọi lại', en: 'System error → callback' },
  tool_loop: { vi: 'AI bí → nhờ gọi lại', en: 'Assistant stuck → callback' },
  deadline: { vi: 'Quá chậm → nhờ gọi lại', en: 'Too slow → callback' },
  transfer: { vi: 'Chuyển cho nhân viên', en: 'Transferred to staff' },
  callback: { vi: 'AI không chắc → nhờ gọi lại', en: 'Unsure → callback' },
  voicemail: { vi: 'Hộp thư thoại', en: 'Voicemail' },
  off_hours: { vi: 'Ngoài giờ AI nghe', en: 'Outside AI hours' },
  in_progress: { vi: 'Đang diễn ra', en: 'In progress' },
};

/** A slow turn, as the health screen counts it. */
export const SLOW_TURN_MS = 8_000;

// ---------------------------------------------------------------- what the hotline says instead of hanging up

/** The lines the hotline says when it must hand the caller to the desk — never a bare "Goodbye". */
export function callbackLines(langCode: string): { silence: string; trouble: string; stuck: string; stillChecking: string[]; noted: string } {
  if (/^vi/i.test(langCode)) {
    return {
      silence: 'Dạ em chưa nghe được anh chị. Em sẽ nhờ nhân viên gọi lại số này trong ít phút để đặt lịch tiếp giúp anh chị ạ. Cảm ơn anh chị!',
      trouble: 'Dạ xin lỗi, hệ thống bên em đang chậm. Em đã ghi lại, nhân viên sẽ gọi lại số này trong ít phút ạ. Cảm ơn anh chị!',
      stuck: 'Dạ phần này em chưa xử lý được, em đã nhờ nhân viên gọi lại anh chị ngay ạ. Anh chị còn cần gì nữa không ạ?',
      stillChecking: ['Dạ em vẫn đang kiểm tra lịch, anh chị chờ em thêm chút ạ.', 'Dạ sắp xong rồi ạ, anh chị đợi em một chút.'],
      noted: 'Dạ em đã ghi lại rồi ạ.',
    };
  }
  return {
    silence: "I couldn't hear you. I'll have a team member call you right back at this number to finish up. Thank you!",
    trouble: "I'm sorry, our system is slow right now. I've noted your request and a team member will call you back at this number in a few minutes. Thank you!",
    stuck: "I can't finish that part myself, so I've asked a team member to call you back shortly. Is there anything else I can help with?",
    stillChecking: ['Still checking the book for you, one moment more.', 'Almost there, thanks for your patience.'],
    noted: 'Got it, noted.',
  };
}
