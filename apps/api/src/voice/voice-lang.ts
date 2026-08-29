/**
 * Bilingual hotline — the decisions, kept pure.
 *
 * Twilio's speech recognition locks ONE language per listening turn, so a
 * caller cannot just switch mid-sentence: the line must KNOW which language it
 * is listening in. Monolingual lines set it once in settings. The new
 * 'bilingual' mode asks the caller at the top of the call — "For English,
 * press 1. Nói tiếng Việt, xin nhấn phím 2." — remembers the choice on the
 * call record, and every later turn listens and speaks in that language.
 *
 * Also here: the per-language canned lines (reprompts, goodbyes, failures).
 * They were hardcoded in English, which meant even a pure-Vietnamese line
 * apologised in English every time it mis-heard something.
 */

export type LangCode = 'en-US' | 'vi-VN';
export const BILINGUAL = 'bilingual';

export const isBilingual = (lineLanguage: string | null | undefined): boolean =>
  String(lineLanguage || '').toLowerCase() === BILINGUAL;

/** The language a given turn actually runs in. */
export function effectiveLang(lineLanguage: string | null | undefined, callLanguage: string | null | undefined): string {
  if (!isBilingual(lineLanguage)) return lineLanguage || 'en-US';
  return callLanguage === 'vi-VN' || callLanguage === 'en-US' ? callLanguage : 'en-US';
}

/**
 * What the caller answered at the menu. Digits are the reliable path; speech
 * is a courtesy — the menu listens in en-US, so Vietnamese speech arrives
 * mangled, but "Vietnamese"/"Viet" survive transcription.
 */
export function parseLangChoice(digits: string | null | undefined, speech: string | null | undefined): LangCode | null {
  const d = String(digits || '').trim();
  if (d === '1') return 'en-US';
  if (d === '2') return 'vi-VN';
  const s = String(speech || '').toLowerCase();
  if (/viet/.test(s)) return 'vi-VN';
  if (/english/.test(s)) return 'en-US';
  return null;
}

/** The two <Say> sentences of the menu — each in ITS OWN language, so the
 *  Vietnamese half is spoken by a Vietnamese voice, not an American one. */
export function menuLines(salonName: string): { en: string; vi: string } {
  return {
    en: `Hi, thanks for calling ${salonName}! You're speaking with our automated assistant. For English, press 1.`,
    vi: 'Để gặp trợ lý tiếng Việt, xin nhấn phím 2.',
  };
}

/**
 * Vietnamese needs a voice that actually SPEAKS Vietnamese. The first version
 * used Twilio's legacy `alice` — whose language list has no vi-VN — so every
 * Vietnamese sentence was read aloud with English phonetics: pure noise, and
 * the first live caller said exactly that ("nói tùm lum"). Twilio's Google
 * voices carry real vi-VN models; the voice name itself encodes the locale.
 */
export function voiceFor(lang: string, configuredVoice: string | null | undefined): { voice: string | null; sayLanguage: string | null } {
  if (configuredVoice) return { voice: configuredVoice, sayLanguage: null };
  // Neural defaults: Wavenet vi / Polly Neural en — the closest to a human
  // that plain TwiML <Say> offers, still one line of config per call.
  if (lang === 'vi-VN') return { voice: 'Google.vi-VN-Wavenet-A', sayLanguage: 'vi-VN' };
  return { voice: 'Polly.Joanna-Neural', sayLanguage: null };
}

/** Canned lines, per language. English keeps today's exact wording. */
export function cannedLines(lang: string): { didntCatch: string; lostYou: string; trouble: string; slowRetry: string; disclosure: (salonName: string) => string; defaultGreeting: string } {
  if (lang === 'vi-VN') {
    return {
      didntCatch: 'Dạ xin lỗi, em chưa nghe rõ. Anh chị cần em hỗ trợ gì ạ?',
      lostYou: 'Hình như em bị mất tín hiệu rồi. Anh chị gọi lại bất cứ lúc nào nhé. Xin chào!',
      trouble: 'Dạ xin lỗi, hệ thống đang gặp trục trặc. Nhân viên sẽ gọi lại cho anh chị ngay ạ. Xin chào!',
      slowRetry: 'Dạ xin lỗi, em xử lý hơi chậm. Anh chị nói lại giúp em một lần nữa được không ạ?',
      disclosure: (salonName: string) => `Xin chào, cảm ơn anh chị đã gọi đến ${salonName}! Anh chị đang trò chuyện với trợ lý tự động của chúng tôi.`,
      defaultGreeting: 'Em có thể giúp gì cho anh chị hôm nay ạ?',
    };
  }
  return {
    didntCatch: "Sorry, I didn't catch that. How can I help you book?",
    lostYou: 'It looks like I lost you. Please call back any time to book. Goodbye!',
    trouble: 'Sorry, I am having trouble right now. A team member will call you back shortly. Goodbye.',
    slowRetry: 'So sorry, that took me a moment too long. Could you say that one more time?',
    disclosure: (salonName: string) => `Hi, thanks for calling ${salonName}! Just so you know, you're speaking with our friendly automated booking assistant.`,
    defaultGreeting: 'How can I help you book an appointment today?',
  };
}

/** One line for the agent's system prompt so the BRAIN answers in the same
 *  language the MOUTH will speak. */
export function agentLangRule(lang: string): string {
  return lang === 'vi-VN'
    ? '\nIMPORTANT: This call is in VIETNAMESE. Reply ONLY in Vietnamese — warm and polite ("dạ", "ạ", address the caller as "anh/chị").'
    : '\nIMPORTANT: This call is in ENGLISH. Reply ONLY in English.';
}
