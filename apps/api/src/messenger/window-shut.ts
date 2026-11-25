/**
 * rt230 — "tôi là người nhắn chứ không phải bot nhưng báo Meta từ chối".
 *
 * Meta's rule is about the CUSTOMER's last message, not about who presses
 * Send: a Page may message a person only within 24 hours of that person's
 * last message, and a human may stretch it to 7 days (HUMAN_AGENT). After 7
 * days no app can send through the API — not the bot, not a receptionist in
 * Lumio. rt236: a person typing in Meta's own inbox (Business Suite) is not
 * bound by this; the inbox links to the conversation there.
 *
 * What went wrong on Lumio Agency (Nguyễn Việt, last activity 27/08): Lumio did
 * not know when the customer last wrote (an imported conversation with no
 * dated customer line), so the box stayed open, the send went to Meta, Meta
 * refused, and the screen said "Meta không cho BOT gửi" to a person who had
 * typed it themselves. Now:
 *   - when our row does not know, the permanent message log is asked;
 *   - once Meta has refused a person's message as "window closed", the
 *     conversation counts as shut until the customer writes again, and the
 *     box says so BEFORE anyone types;
 *   - the words say what the rule is, for a person, and what to do instead.
 */
import { lastInboundAt } from './human-agent';

/** Meta refused a person's message because the reply window is shut. */
export interface ShutMark { windowShut?: boolean }

/**
 * A person's message refused as "window closed" AFTER the newest customer
 * line we know of (or with no customer line known at all): Meta has told us
 * the window is shut, and nothing since has opened it.
 */
export function shutByMeta(history: unknown): boolean {
  const rows = Array.isArray(history) ? history : [];
  const lastIn = lastInboundAt(rows);
  const inMs = lastIn ? Date.parse(lastIn) : NaN;
  for (const r of rows as ({ role?: string; manual?: boolean; failed?: boolean; at?: string } & ShutMark)[]) {
    if (!r || r.role !== 'assistant' || !r.failed || !r.windowShut) continue;
    if (!Number.isFinite(inMs)) return true;
    const t = Date.parse(String(r.at ?? ''));
    if (Number.isFinite(t) && t > inMs) return true;
  }
  return false;
}

/** What a person reads when Meta refuses THEIR message because the window is shut. */
export function personWindowReason(ageHours: number | null | undefined): string {
  const days = typeof ageHours === 'number' && Number.isFinite(ageHours) && ageHours >= 24 ? Math.floor(ageHours / 24) : null;
  const when = days !== null ? `Khách nhắn Page lần cuối cách đây ${days} ngày. ` : 'Khách đã lâu không nhắn Page. ';
  if (days !== null && days < 7) {
    return `${when}Quá 24 giờ, Meta chỉ nhận tin của người thật (nhãn Human Agent) trong 7 ngày — lần này Meta vẫn từ chối. Anh/chị trả lời khách trong Meta Business Suite, hoặc gọi/nhắn SMS nếu có số.`;
  }
  return `${when}Luật của Meta: Page chỉ được nhắn khách trong 7 ngày kể từ tin cuối của KHÁCH — sau đó Meta không cho phần mềm nào gửi qua API nữa (Lumio, chatbot, mọi phần mềm dùng API chính thức), không phải lỗi bot hay lỗi Lumio. Bấm "Nhắn trong Business Suite" để nhắn tay ngay trên Facebook, hoặc gọi điện / SMS / email. Khi khách nhắn lại là trả lời ở đây được ngay.`;
}
