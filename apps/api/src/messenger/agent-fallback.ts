/**
 * What the bot says — and DOES — when it cannot think.
 *
 * The old failure path sent one hardcoded line: "Thanks! A team member will
 * get back to you shortly. 💕". Three things were wrong with it, and a real
 * customer hit all three at once (asked a pricing question in Vietnamese at
 * 6:18, got that English line at 11:08):
 *
 *   1. Wrong language. A Vietnamese conversation got an English shrug.
 *   2. Wrong register. "Thanks!" reads like an answer that dodged the
 *      question — the customer can't tell a system error from a brush-off.
 *   3. An empty promise. Nothing marked the thread as needing a person, so
 *      no team member was ever going to "get back shortly".
 *
 * This module fixes the words (right language, honest apology); the service
 * fixes the promise (thread flagged for a human + staff push notification)
 * and retries transient API errors before giving up at all.
 */

const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

// Unaccented Vietnamese is common on phones ("gia bao nhieu"). These stems are
// distinctive enough that English text won't trip them.
const VI_STEMS = /\b(bao nhieu|khong a|dat lich|cam on|xin chao|toi muon|bao gia|duoc khong|chi oi|anh oi|em oi|nhieu tien)\b/i;

const CLEARLY_EN = /\b(the|what|how much|price|hello|please|thanks|thank you|can you|i want|do you)\b/i;

/**
 * Language of the CONVERSATION (all customer turns joined), not the last
 * message — mirrors the agent's own language rule. Defaults to Vietnamese:
 * this product's customers are Vietnamese-speaking businesses, and a wrong
 * "dạ em xin lỗi" to an English speaker is far less damaging than a wrong
 * English brush-off to a Vietnamese customer mid-purchase.
 */
export function looksVietnamese(conversationText: string): boolean {
  const s = String(conversationText || '');
  if (VI_DIACRITICS.test(s)) return true;
  if (VI_STEMS.test(s)) return true;
  return !CLEARLY_EN.test(s);
}

/**
 * The holding line. An honest one: apologise for the delay, promise a person,
 * and DON'T pretend the question was handled. Never "Thanks!" — gratitude for
 * a question we failed to answer reads as evasion.
 */
export function fallbackText(conversationText: string): string {
  return looksVietnamese(conversationText)
    ? 'Dạ em xin lỗi, hệ thống đang hơi chậm một chút 🙏 Em đã chuyển tin nhắn của anh/chị cho nhân viên — bên em sẽ trả lời ngay khi có thể ạ.'
    : 'So sorry — our system is a little slow right now 🙏 I\'ve flagged your message for a teammate, and someone will reply here as soon as possible.';
}

/** API statuses worth ONE quiet retry before bothering the customer.
 *  429/529 are Anthropic's "busy right now"; 5xx are momentary. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * The staff-side alarm that makes the promise true. Its own tag so a routine
 * "new message" push can never replace it on a lock screen.
 */
export function escalationPush(name: string | null | undefined, vi: boolean): { title: string; body: string; url: string; tag: string } {
  const who = String(name ?? '').trim() || (vi ? 'Khách' : 'A customer');
  return {
    title: vi ? `⚠ AI chưa trả lời được — ${who} đang chờ` : `⚠ AI could not reply — ${who} is waiting`,
    body: vi ? 'Bot gặp lỗi, đã gửi câu xin chờ. Vào trả lời khách ngay nhé.' : 'The bot hit an error and sent a holding line. Please reply now.',
    url: '/staff/inbox',
    tag: 'lumio-inbox-escalation',
  };
}
