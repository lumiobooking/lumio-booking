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
}

export function readSendRefusal(status: number, err: GraphError | null | undefined): SendRefusal {
  const code = err?.code ?? 0;
  const sub = err?.error_subcode ?? 0;
  const msg = String(err?.message ?? '').trim();
  const tag = `${code || status}${sub ? `/${sub}` : ''}`;
  const threadControl = /thread[\s_-]*(control|owner)|handover|secondary receiver|not the owner/i.test(msg) || sub === 2018300;
  const transient = code === 1 || code === 2 || code === 4 || code === 613 || code === 32 || status >= 500;
  let reason: string;
  if (threadControl) reason = 'Một ứng dụng khác đang giữ cuộc trò chuyện (tin tự động của quảng cáo, Meta Business AI hoặc công cụ chat khác).';
  else if (code === 10 && (sub === 2018278 || sub === 2018065 || /outside of allowed window/i.test(msg))) reason = 'Đã quá 24 giờ kể từ tin cuối của khách — Meta không cho bot gửi.';
  else if (code === 190) reason = 'Mã truy cập Facebook Page đã hết hạn — cần kết nối lại Page.';
  else if (code === 200 || code === 230 || code === 10) reason = 'Page chưa cấp quyền nhắn tin cho Lumio (pages_messaging) — cần kết nối lại Page.';
  else if (code === 551 || sub === 1545041) reason = 'Khách không nhận tin lúc này (đã chặn Page hoặc không còn liên lạc được).';
  else if (code === 100 && (sub === 2018001 || /no matching user/i.test(msg))) reason = 'Meta không tìm thấy khách này trên Page.';
  else if (transient) reason = 'Meta tạm thời không nhận tin — thử lại sau ít phút.';
  else reason = msg ? `Meta từ chối: ${msg.slice(0, 160)}` : `Meta từ chối tin nhắn (HTTP ${status}).`;
  return { code: tag, reason, threadControl, transient };
}
