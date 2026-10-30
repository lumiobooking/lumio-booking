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
  /** Meta's own words, as it sent them (trimmed) — shown to the salon next to ours, never replaced by a guess. */
  meta: string;
  /** Meta's trace id, for a support ticket with Meta. */
  trace: string;
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
  return { code: tag, reason, threadControl, transient: transient && !pageRestricted, pageRestricted, windowClosed, meta: msg.replace(/^\(#\d+\)\s*/, '').slice(0, 200), trace: String(err?.fbtrace_id ?? '').slice(0, 40) };
}

/**
 * "Outside of allowed window" while the customer wrote moments ago.
 *
 * Seen on Zb Nails & Spa (25 Oct 2026, the ad's greeting went out a little
 * later and sends worked after it) and on Lumio Agency (30 Oct 2026, Demy
 * Nguyen: an ad conversation with NO greeting configured — the owner said so
 * — refused for over a minute). The first explanation written here blamed an
 * ad greeting still going out; that was a guess from one case and it was
 * wrong for the second. We do not know why Meta refuses a reply seconds after
 * a customer wrote, so we do not say we do: the inbox shows what Meta itself
 * answered (its code and words), and the bot keeps trying.
 *
 * What the bot does about it: take thread control (in case another app or
 * Meta's own tools hold the conversation), resend twice within a minute, and
 * then keep the reply and resend it on a schedule (FRESH_RETRY_AFTER_MIN)
 * while the customer's 24 hours last — unless a person answers or takes the
 * chat first.
 */
export const AD_HOLD_RETRY_MS = [20_000, 30_000];
/** Minutes after the first refusal at which the kept reply is sent again. */
export const FRESH_RETRY_AFTER_MIN = [2, 4, 8, 15, 30, 60];

/** A "window closed" refusal on a customer who wrote less than 23 hours ago. */
export function freshWindowRefusal(r: Pick<SendRefusal, 'windowClosed'>, customerAgeMs: number | null | undefined): boolean {
  if (!r.windowClosed) return false;
  if (customerAgeMs === null || customerAgeMs === undefined || !Number.isFinite(customerAgeMs)) return false;
  return customerAgeMs >= 0 && customerAgeMs < 23 * 3600 * 1000;
}
/** @deprecated the old name — the cause is not known to be an ad greeting. */
export const adGreetingHold = freshWindowRefusal;

/**
 * May a refused reply be sent again later? Everything except what cannot
 * change by itself or must not be retried:
 *   - the customer is not reachable (blocked the Page / no such person);
 *   - the window is really closed (the customer wrote 23 h+ ago).
 * Meta being busy, a thread held by another tool, a token or permission the
 * salon fixes by reconnecting, a Page restriction that lifts — all of these
 * are tried again on the schedule, so a reply is not lost to a bad minute.
 */
export function retryableRefusal(r: Pick<SendRefusal, 'code' | 'windowClosed'>, customerAgeMs: number | null | undefined): boolean {
  if (/^551\b|1545041|2018001/.test(r.code)) return false;
  if (r.windowClosed) return freshWindowRefusal(r, customerAgeMs);
  if (customerAgeMs !== null && customerAgeMs !== undefined && Number.isFinite(customerAgeMs) && customerAgeMs > 23 * 3600 * 1000) return false;
  return true;
}

/** The plan line: "Bot sẽ tự gửi lại lúc 13:37 (đã thử 3 lần)." or the hand-over line. */
export function retryNote(plan: { tries: number; nextAt?: Date | null; tz?: string }): string {
  if (plan.nextAt) {
    const at = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, ...(plan.tz ? { timeZone: plan.tz } : {}) }).format(plan.nextAt);
    return `Bot đã thử ${plan.tries} lần và sẽ tự gửi lại lúc ${at}. Nhân viên có thể trả lời trước trong Hộp thư hoặc Business Suite.`;
  }
  return `Bot đã thử ${plan.tries} lần không được — nhân viên trả lời giúp trong Hộp thư hoặc Business Suite.`;
}

/**
 * The whole sentence for the inbox: our plain reading, Meta's own words and
 * code (never only our reading), and what happens next.
 */
export function describeRefusal(r: Pick<SendRefusal, 'code' | 'meta' | 'reason' | 'windowClosed'>, customerAgeMs: number | null, plan: { tries: number; nextAt?: Date | null; tz?: string } | null): string {
  if (r.windowClosed && customerAgeMs !== null && freshWindowRefusal(r, customerAgeMs)) {
    return freshWindowReason(r, customerAgeMs, plan ?? { tries: 1 });
  }
  const meta = r.meta && !r.reason.includes(r.meta) ? ` (Meta: “${r.meta}”, mã ${r.code})` : ` (mã ${r.code})`;
  return `${r.reason}${meta}${plan ? ` ${retryNote(plan)}` : ''}`;
}

/** "70 giây" / "3 phút" / "2 giờ". */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} giây`;
  if (s < 5400) return `${Math.round(s / 60)} phút`;
  return `${Math.round(s / 3600)} giờ`;
}

/**
 * The sentence for a fresh-window refusal: what Meta answered, when the
 * customer wrote, and what the bot will do next — no guessed cause.
 */
export function freshWindowReason(r: Pick<SendRefusal, 'code' | 'meta'>, customerAgeMs: number, next: { tries: number; nextAt?: Date | null; tz?: string }): string {
  const metaSaid = r.meta ? ` — Meta trả lời: “${r.meta}”` : '';
  const head = `Meta từ chối tin của bot (mã ${r.code}${metaSaid}) dù khách vừa nhắn ${ago(customerAgeMs)} trước.`;
  return `${head} ${retryNote(next)}`;
}
