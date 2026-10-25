/**
 * What Meta said when it refused one of our messages — read, not swallowed.
 *
 * WHY THIS EXISTS
 *
 * The bot's send went to the Graph API and returned "ok" whatever came back.
 * A refused reply was written into the conversation like a delivered one, so
 * the inbox showed the bot answering while the customer, on Messenger, saw
 * nothing. "Trên hệ thống thì thấy trả lời, nhưng trên Meta không thấy."
 *
 * Now every refusal is read into a code and one plain sentence for the salon,
 * and the two refusals worth one more try are recognised:
 *   - another app holds the conversation (Meta's Handover Protocol: an ad's
 *     automated greeting, Meta's Business AI, a chat tool the page used
 *     before) — take the thread back, then send again;
 *   - Meta was briefly unavailable or rate-limiting — send again once.
 *
 * Pure (send-errors.spec.ts).
 */

export interface GraphError { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string }

export interface SendRefusal {
  /** "10/2018278" — what Meta returned, for the log and the support team. */
  code: string;
  /** One sentence for the inbox, in Vietnamese (the salons' team reads it). */
  reason: string;
  /** Another app holds the thread: take control, then try once more. */
  threadControl: boolean;
  /** Worth one more try as it is. */
  transient: boolean;
  /** Meta has restricted the whole Page from sending — every reply will fail until it lifts. */
  pageRestricted: boolean;
  /** Meta says the reply window is closed ("outside of allowed window"). */
  windowClosed: boolean;
}

export function readSendRefusal(status: number, err: GraphError | null | undefined): SendRefusal {
  const code = err?.code ?? 0;
  const sub = err?.error_subcode ?? 0;
  const msg = String(err?.message ?? '').trim();
  const tag = `${code || status}${sub ? `/${sub}` : ''}`;
  const threadControl = /thread[\s_-]*(control|owner)|handover|secondary receiver|not the owner/i.test(msg) || sub === 2018300;
  const transient = code === 1 || code === 2 || code === 4 || code === 613 || code === 32 || status >= 500;
  // (#2022) "You're temporarily restricted from sending messages until …".
  // Reads like a penalty on the Page, but on 24 Oct 2026 (Lumio Agency) the
  // Page status showed no issue at all and RECONNECTING the Page (a fresh
  // token + subscription) made sends work at once. So the first advice is
  // to reconnect; Business Suite is the fallback.
  const pageRestricted = code === 2022 || sub === 1404078 || /restricted from sending|tạm thời bị hạn chế gửi tin/i.test(msg);
  const windowClosed = code === 10 && (sub === 2018278 || sub === 2018065 || /outside of allowed window/i.test(msg));
  let reason: string;
  if (pageRestricted) reason = `Meta đang hạn chế Page gửi tin nhắn${msg ? ` — ${msg.replace(/^\(#\d+\)\s*/, '')}` : ''}. Làm trước: vào Messenger → “Thêm page / kết nối lại” (24/10 Lumio Agency kết nối lại là gửi được ngay). Chưa được thì trả lời khách trong Meta Business Suite.`;
  else if (threadControl) reason = 'Một ứng dụng khác đang giữ cuộc trò chuyện (tin tự động của quảng cáo, Meta Business AI hoặc công cụ chat khác).';
  else if (windowClosed) reason = 'Đã quá 24 giờ kể từ tin cuối của khách — Meta không cho bot gửi.';
  else if (code === 190) reason = 'Mã truy cập Facebook Page đã hết hạn — cần kết nối lại Page.';
  else if (code === 200 || code === 230 || code === 10) reason = 'Page chưa cấp quyền nhắn tin cho Lumio (pages_messaging) — cần kết nối lại Page.';
  else if (code === 551 || sub === 1545041) reason = 'Khách không nhận tin lúc này (đã chặn Page hoặc không còn liên lạc được).';
  else if (code === 100 && (sub === 2018001 || /no matching user/i.test(msg))) reason = 'Meta không tìm thấy khách này trên Page.';
  else if (transient) reason = 'Meta tạm thời không nhận tin — thử lại sau ít phút.';
  else reason = msg ? `Meta từ chối: ${msg.slice(0, 160)}` : `Meta từ chối tin nhắn (HTTP ${status}).`;
  return { code: tag, reason, threadControl, transient: transient && !pageRestricted, pageRestricted, windowClosed };
}

/**
 * "Outside of allowed window" ten seconds after the customer wrote.
 *
 * Seen on Zb Nails & Spa, 25 Oct 2026: a customer tapped a click-to-Messenger
 * ad's ready-made question ("Do I need to book an appointment in advance?") at
 * 13:01:21, the bot answered at 13:01:31 and Meta refused it as outside the
 * 24-hour window. Meta's own ad greeting ("Hi Stephany! Please let us know how
 * we can help you.") only went out at 13:02:01, and from then on every send
 * worked. While an ad's welcome flow is still running, the Page cannot answer
 * through the API. So when the window "closed" on a customer who wrote minutes
 * ago, it is not closed: wait for the greeting and send again.
 */
export const AD_HOLD_RETRY_MS = [20_000, 30_000];
export const AD_HOLD_REASON = 'Khách vừa nhắn từ quảng cáo và Meta còn đang gửi câu chào tự động của quảng cáo, nên chưa cho bot trả lời. Bot đã thử lại 2 lần trong 1 phút — nhân viên trả lời giúp trong Hộp thư.';

export function adGreetingHold(r: Pick<SendRefusal, 'windowClosed'>, customerAgeMs: number | null | undefined): boolean {
  if (!r.windowClosed) return false;
  if (customerAgeMs === null || customerAgeMs === undefined || !Number.isFinite(customerAgeMs)) return false;
  return customerAgeMs >= 0 && customerAgeMs < 23 * 3600 * 1000;
}
