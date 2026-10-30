/**
 * Lines Meta writes into a conversation that nobody typed.
 *
 * When a customer answers a click-to-Messenger ad, the Page's transcript gets
 * "Allison Quinn replied to an ad." — or, when the Page admin's Facebook is in
 * Vietnamese, "Allison Quinn đã trả lời một quảng cáo." — and it comes back
 * as if the PAGE had sent it. Shown to the model as one of "our" earlier
 * replies, a Vietnamese one pulled an English conversation towards Vietnamese.
 * They are events, not messages: kept in the record, never fed to the model.
 *
 * Mirrors web/src/lib/inbox-view.ts systemEventOf. Pure (meta-system-lines.spec.ts).
 */
const AD_REPLY_EN = /^(?:[^\n]{1,80}\s)?replied to (?:an|your) ad\.?$/i;
const AD_REPLY_VI = /^(?:[^\n]{1,80}\s)?đã trả lời (?:một |1 )?quảng cáo(?: của bạn)?\.?$/i;
const OPENED_CHAT = /^(?:\u{1F44B}\s*)?\(opened chat\)$/iu;

/*
 * More notices, read off the live transcripts of 28 salons (30 Oct 2026).
 * Each of these came back as if the Page had typed it, was taken for a
 * person answering, and put the bot aside for its "human is talking" grace —
 * one of the ways "the AI stopped answering" without any error anywhere:
 *   "X replied to your automated welcome message. To change or remove this
 *    greeting, visit Messaging settings." (and the Vietnamese form),
 *   "X replied to a post. View post(<link>)" / "X đã trả lời về một bài viết. Xem bài viết(<link>)",
 *   "Bạn đã trả lời Mercedes chưa? Họ đang chờ bạn đấy." (Meta nudging the Page).
 */
const WELCOME_EN = /^[^\n]{1,80}\sreplied to your automated welcome message\.(?:\s[\s\S]{0,200})?$/i;
const WELCOME_VI = /^[^\n]{1,80}\sđã trả lời tin nhắn chào mừng tự động của bạn\.(?:\s[\s\S]{0,200})?$/i;
const POST_EN = /^[^\n]{1,80}\sreplied to (?:a|your) (?:post|story|comment)\.(?:\s*View (?:post|story|comment)[\s\S]{0,700})?$/i;
const POST_VI = /^[^\n]{1,80}\sđã trả lời (?:về )?(?:một |1 )?(?:bài viết|bình luận)(?: của bạn)?\.(?:\s*Xem (?:bài viết|bình luận)[\s\S]{0,700})?$/i;
const NUDGE_VI = /^Bạn đã trả lời [^\n]{1,80} chưa\? Họ đang chờ bạn(?: đấy)?\.?$/i;
const NUDGE_EN = /^(?:Have|Did) you repl(?:y|ied) to [^\n]{1,80}\? (?:They(?:'|’)re|They are) waiting(?: for you)?\.?$/i;

export function isMetaSystemLine(text: unknown): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > 900) return false;
  if (t.length <= 140 && (AD_REPLY_EN.test(t) || AD_REPLY_VI.test(t) || OPENED_CHAT.test(t))) return true;
  return WELCOME_EN.test(t) || WELCOME_VI.test(t) || POST_EN.test(t) || POST_VI.test(t) || NUDGE_VI.test(t) || NUDGE_EN.test(t) || isMetaAiLine(t);
}

/**
 * Meta's own AI (Business AI / "AI agent") announcing itself in the chat:
 * "Your AI agent will respond." — seen on CÁ NGỪ ĐẠI DƯƠNG CHỊ THUẬN and
 * The Crab Station. From then on Meta's AI answers the customer, its replies
 * echo like a person typing, and Lumio's bot stands aside: two AIs on one
 * Page, and the salon's own one silent. Recognised so the salon is TOLD
 * (webhook-status.metaAi, a red line on the Messenger page, a push).
 */
const META_AI = /^Your AI agent will respond\.?$/i;
const META_AI_HANDBACK = /^Your AI Agent transferred this chat to you\b[\s\S]{0,240}$/i;
const META_AI_VI = /^(?:Tác tử|Trợ lý) AI của bạn sẽ (?:trả lời|phản hồi)\.?$/i;
export function isMetaAiLine(text: unknown): boolean {
  const t = String(text ?? '').trim();
  return t.length <= 300 && (META_AI.test(t) || META_AI_HANDBACK.test(t) || META_AI_VI.test(t));
}

/**
 * Meta's default greeting for a click-to-Messenger ad, sent by Meta in the
 * Page's name ("Hi Stephany! Please let us know how we can help you." —
 * "Chào Allison! Chúng tôi có thể giúp gì cho bạn?"). Not a person answering.
 */
const AD_GREETING_EN = /^hi\s[^\n!]{1,60}!\s*please let us know how we can help you\.?$/i;
const AD_GREETING_VI = /^chào\s[^\n!]{1,60}!\s*chúng tôi có thể giúp gì cho bạn\??$/i;
export function isMetaAdGreeting(text: unknown): boolean {
  const t = String(text ?? '').trim();
  return t.length <= 140 && (AD_GREETING_EN.test(t) || AD_GREETING_VI.test(t));
}
