/**
 * WHAT LANGUAGE IS THIS CONVERSATION IN?
 *
 * One detector for every AI the product speaks with — Messenger, Instagram,
 * Zalo, the web widget and the phone line — because the rule a salon expects
 * is the same everywhere: answer the customer in the customer's language.
 *
 * WHY THIS EXISTS
 *
 * The first detector (messenger/agent-fallback.ts) answered one question,
 * "is this Vietnamese?", and defaulted to yes. That was right for a holding
 * line on a Vietnamese page and wrong for everything else: an American
 * customer writing "Are you open Sunday?" hit none of its ten English words
 * and was served Vietnamese. Most Lumio salons are in the United States, so
 * the damage runs the other way round now.
 *
 * So this module answers a three-valued question — vi, en, or "cannot tell"
 * — and never guesses on a coin toss. A caller that must produce an answer
 * (a canned line, a date format) supplies its own fallback and owns that
 * decision; the AI prompt is simply told nothing when the signal is absent,
 * which is what "reply in their language" already handles well.
 *
 * WHAT IT READS
 *
 * Only the CUSTOMER's words, and the whole run of them rather than the last
 * message: "ok" and "thank you" are said in the middle of Vietnamese
 * conversations every day and must not flip the language, while a customer
 * who has written three English sentences does not become Vietnamese by
 * typing "ok" either. Each message votes; the side with more votes wins.
 */

/** Vietnamese is unmistakable when it is accented. */
const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/**
 * Unaccented Vietnamese is normal on phones ("gia bao nhieu", "dat lich").
 * Every stem here is a whole word or phrase that English does not produce.
 */
const VI_STEMS = /(^|\s)(bao nhieu|nhieu tien|gia bao|dat lich|hen lich|cam on|xin chao|toi muon|em muon|minh muon|bao gia|duoc khong|khong a|co khong|chi oi|anh oi|em oi|ban oi|may gio|hom nay|ngay mai|lam mong|son gel|chi tiet|dia chi|so dien thoai|mo cua|dong cua)(\s|$)/i;

/**
 * Single Vietnamese function words. One alone means little — "la", "co" and
 * "toi" all appear inside English words — so they are matched as whole words
 * and only counted when the message has no English signal at all.
 */
const VI_WORDS = /(^|\s)(dạ|da|vâng|vang|ạ|oi|nhé|nhe|ko|khong|không|được|duoc|mình|minh|bạn|ban|anh|chị|chi|em|shop|tiệm|tiem|làm|lam|muốn|muon|đặt|dat|lịch|lich|giá|gia|tiền|tien|mấy|may|giờ|gio|nay|mai|có|co|là|la|cho|với|voi|rồi|roi|nữa|nua)(\s|$)/i;

/**
 * English signal. Wide on purpose: the words a customer actually uses to book
 * — days, times, questions, the vocabulary of a nail salon — not just "the".
 */
const EN_WORDS = /\b(the|a|an|is|are|do|does|did|can|could|would|will|i|i'm|im|you|your|my|me|we|us|and|for|with|at|on|in|to|of|please|thanks|thank|hi|hello|hey|good|morning|afternoon|evening|what|when|where|how|much|cost|price|prices|open|opening|close|closed|hours|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|book|booking|appointment|appointments|schedule|reschedule|cancel|available|availability|walk|in|time|slot|nail|nails|manicure|pedicure|gel|acrylic|fill|full|set|polish|dip|powder|lash|lashes|wax|waxing|facial|massage|haircut|color|name|number|phone|yes|no|sure|okay|ok|need|want|like|have|got|take|give|tell|know|see|come|call|text|send|sorry|great|thank you)\b/i;

/**
 * A whole message that is only courtesy. These are said in both languages —
 * a Vietnamese customer types "thank you" and an English one types "ok" —
 * so such a message votes for neither side rather than flipping the thread.
 */
const COURTESY_ONLY = /^(ok|oke|okay|okie|k|thanks|thank you|thank u|thx|ty|hi|hello|hey|yes|yep|no|nope|sure|great|perfect|cool|nice|bye|goodbye|good|got it|alright)[\s!.,?…\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]*$/iu;

export type ReplyLang = 'vi' | 'en';

/**
 * One message's language, or null when it carries no signal ("ok", "👍",
 * "123", an emoji, a bare phone number).
 */
export function detectLang(text: unknown): ReplyLang | null {
  // Stage directions the SYSTEM wrote into the customer's turn —
  // "[Khách gửi 1 ảnh]" for a photo — are ours, not theirs. Counting them
  // would let a photo from an English-speaking customer flip the thread.
  const raw = String(text ?? '').replace(/\[[^\]]*\]/g, ' ').trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (COURTESY_ONLY.test(s)) return null;
  if (VI_DIACRITICS.test(s) || VI_STEMS.test(s)) return 'vi';
  const en = EN_WORDS.test(s);
  const vi = VI_WORDS.test(s);
  // "ok", "thanks", "hi" — said in both languages, so they decide nothing on
  // their own. Two or more English words is a sentence, and a sentence counts.
  if (en && !vi) return enWordCount(s) >= 2 ? 'en' : null;
  if (vi && !en) return 'vi';
  return null;
}

function enWordCount(s: string): number {
  const words = s.split(/[^a-z']+/i).filter(Boolean);
  let n = 0;
  for (const w of words) if (EN_WORDS.test(w)) n += 1;
  return n;
}

/**
 * The language of the conversation: every customer message votes, the
 * majority wins, and a tie or a silent conversation returns null. Later
 * messages weigh a little more so a customer who switches for real is
 * followed within a message or two.
 */
export function conversationLang(customerTexts: readonly unknown[]): ReplyLang | null {
  const texts = (customerTexts ?? []).slice(-12);
  let vi = 0;
  let en = 0;
  texts.forEach((t, i) => {
    const w = i >= texts.length - 3 ? 2 : 1;
    const l = detectLang(t);
    if (l === 'vi') vi += w;
    else if (l === 'en') en += w;
  });
  if (vi === en) return null;
  return vi > en ? 'vi' : 'en';
}

/**
 * The line every AI prompt carries. Said plainly and symmetrically: neither
 * language is the default, and the model is told what NOT to do in both
 * directions, because "reply in their language" alone lost to a prompt whose
 * scaffolding happened to be Vietnamese.
 */
export function replyLangRule(lang: ReplyLang | null): string {
  if (lang === 'en') {
    return '\nLANGUAGE — NOT NEGOTIABLE: this customer is writing in ENGLISH, so every word you send is in ENGLISH. Do not send Vietnamese, not one word, not a greeting, not "dạ" or "ạ" — even if your notes, the salon\'s information or an internal system message you are shown happens to be in Vietnamese. Translate anything you need from those into natural English before you say it. Switch to Vietnamese only if the customer writes a full sentence in Vietnamese first.';
  }
  if (lang === 'vi') {
    return '\nNGÔN NGỮ — BẮT BUỘC: khách đang nhắn/nói TIẾNG VIỆT, nên toàn bộ câu trả lời phải bằng tiếng Việt, xưng hô lễ phép ("dạ", "ạ", gọi khách là "anh/chị"). Khách chêm vài từ tiếng Anh ("ok", "thank you") KHÔNG phải là đổi sang tiếng Anh. Chỉ chuyển sang tiếng Anh khi khách viết hẳn một câu tiếng Anh.';
  }
  return '\nLANGUAGE: reply in the language the customer is using, judged from their messages as a whole. If they write English, answer only in English; if they write Vietnamese, answer only in Vietnamese ("dạ", "ạ", "anh/chị"). One borrowed word — "ok", "thank you" — never switches the language. When you genuinely cannot tell, use the language of their most recent full sentence.';
}

/** The locale for dates and times said to this customer. */
export function localeForLang(lang: ReplyLang | null, fallback = 'en-US'): string {
  return lang === 'vi' ? 'vi-VN' : lang === 'en' ? 'en-US' : fallback;
}

/**
 * A one-clause reminder attached to a sentence the CODE wrote for the model
 * to say. Our refusal and policy sentences are stored in Vietnamese; without
 * this, a small model hands a Vietnamese sentence straight to an English
 * customer instead of translating it.
 */
export function sayIn(lang: ReplyLang | null): string {
  if (lang === 'en') return ' The customer is writing in ENGLISH — translate the sentence below into natural English and say it in English.';
  if (lang === 'vi') return ' Khách đang dùng TIẾNG VIỆT — nói câu dưới đây bằng tiếng Việt.';
  return ' Say it in the customer\'s own language, translating it if needed.';
}
