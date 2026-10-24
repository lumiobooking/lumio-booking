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

export function isMetaSystemLine(text: unknown): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > 140) return false;
  return AD_REPLY_EN.test(t) || AD_REPLY_VI.test(t) || OPENED_CHAT.test(t);
}
