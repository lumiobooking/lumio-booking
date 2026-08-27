import { Logger } from '@nestjs/common';
import { SendResult, SmsMessage, SmsProvider } from './notification-provider.interface';

/**
 * SMS inside Vietnam, through eSMS.vn.
 *
 * WHY NOT TWILIO
 *
 * Twilio can technically address a Vietnamese number, and that is the trap.
 * Vietnamese carriers filter A2P traffic: an unregistered sender is accepted by
 * Twilio, returns a message SID, and is then dropped by the carrier. Twilio's
 * own documentation says delivery over an unregistered long code is "lower
 * quality or disallowed", and that carriers there allowlist message templates
 * AND urls. A booking link that changes per salon is exactly the shape that gets
 * blocked — so the failure would be invisible, per-salon, and permanent.
 *
 * eSMS is a domestic aggregator: it registers the brandname with the carriers on
 * the business's behalf, and it separates the two message categories Vietnamese
 * law separates.
 *
 * THE THING THAT LOOKS LIKE SUCCESS AND IS NOT
 *
 * From eSMS's own docs, emphasis theirs:
 *
 *   "Mã phản hồi 100 chỉ xác nhận rằng yêu cầu đã được gửi thành công đến hệ
 *    thống ESMS, KHÔNG phản ánh việc tin nhắn đã được gửi đến số điện thoại
 *    người nhận hay chưa."
 *
 * CodeResult 100 means eSMS accepted the request. It does NOT mean the customer
 * received anything. The real outcome only arrives later on CallbackUrl. This
 * class therefore reports 100 as `accepted`, never as `delivered`, and carries
 * the SMSID so a callback can settle it. Recording 100 as "sent" would rebuild
 * the same blind spot that Twilio-to-Vietnam has.
 *
 * TRANSACTIONAL ONLY, DELIBERATELY
 *
 * This adapter implements the CSKH/OTP endpoint (one recipient per call).
 * Advertising is a DIFFERENT endpoint (SendMultipleSMSBrandname_json) with a
 * hard floor of 30 recipients per request — error 107, "Each request has at
 * least 30 numbers to be approved". The campaign engine sends one customer at a
 * time, so pointing it here would fail on every single send. Remarketing needs
 * a batching design of its own; it is not a flag on this class.
 */

export interface ESmsConfig {
  apiKey: string;
  secretKey: string;
  /** Registered with the carriers before use. An unregistered one is error 104. */
  brandname: string;
  /** Where eSMS posts the real delivery outcome. Without it, 100 is all we ever learn. */
  callbackUrl?: string;
  /** '1' sends nothing and charges nothing — for verifying wiring. */
  sandbox?: boolean;
}

const logger = new Logger('ESms');

const ENDPOINT = 'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/';

/** eSMS message type 2 = chăm sóc khách hàng. Type 1 is advertising and belongs
 *  to a different endpoint with different law attached to it. */
const SMS_TYPE_CSKH = '2';

/**
 * eSMS wants a Vietnamese number in LOCAL form — "0901888484" — where Twilio
 * wants E.164. Sending one the other's format is a silent failure, so this
 * converts rather than assuming.
 */
export function toVietnamLocal(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;

  // +84 / 0084 / 84 prefix → drop it and restore the leading 0.
  let national = digits;
  if (national.startsWith('0084')) national = national.slice(4);
  else if (national.startsWith('84') && national.length >= 11) national = national.slice(2);
  else if (national.startsWith('0')) national = national.slice(1);

  // Vietnamese mobile numbers are 9 digits after the trunk 0, and every mobile
  // prefix begins with 3, 5, 7, 8 or 9 since the 2018 renumbering. Anything else
  // is a landline or a mistake, and guessing is worse than refusing.
  if (!/^[35789]\d{8}$/.test(national)) return null;
  return `0${national}`;
}

/** Vietnamese with tone marks costs a unicode SMS (70 chars, not 160), so the
 *  flag has to match the content or the message is truncated or rejected. */
export function needsUnicode(text: string): boolean {
  // Anything outside plain ASCII. Written as a code-point comparison rather
  // than a regex range: the escapes for the range ends are control characters,
  // and a source file that literally contains NUL is a file that tools start
  // treating as binary — which is exactly what happened on the first attempt.
  return String(text ?? '').split('').some((c) => c.charCodeAt(0) > 127);
}

/** What each eSMS CodeResult actually means, in words an operator can act on. */
export function describeCode(code: string, fallback?: string): string {
  switch (String(code)) {
    case '101': return 'Sai ApiKey/SecretKey của eSMS';
    case '104': return 'Brandname chưa đăng ký hoặc chưa được kích hoạt';
    case '107': return 'Tin quảng cáo cần tối thiểu 30 số trong một lần gửi';
    case '124': return 'RequestId đã dùng rồi (eSMS chặn trùng trong 24h)';
    case '146': return 'Mẫu tin CSKH chưa được đăng ký với nhà mạng';
    case '99': return 'eSMS từ chối request — kiểm tra lại thông tin kết nối';
    default: return fallback ? `eSMS ${code}: ${fallback}` : `eSMS trả về mã ${code}`;
  }
}

export class ESmsProvider implements SmsProvider {
  readonly name = 'esms';

  constructor(private readonly config: ESmsConfig) {}

  async sendSms(message: SmsMessage & { requestId?: string }): Promise<SendResult> {
    const to = toVietnamLocal(message.to);
    if (!to) return { success: false, error: `Số điện thoại không hợp lệ cho Việt Nam: "${message.to}"` };
    if (!this.config.brandname) return { success: false, error: 'Chưa cấu hình Brandname eSMS' };

    const body: Record<string, string> = {
      ApiKey: this.config.apiKey,
      SecretKey: this.config.secretKey,
      Brandname: this.config.brandname,
      Content: message.body,
      Phone: to,
      SmsType: SMS_TYPE_CSKH,
      IsUnicode: needsUnicode(message.body) ? '1' : '0',
    };
    if (this.config.sandbox) body.Sandbox = '1';
    if (this.config.callbackUrl) body.CallbackUrl = this.config.callbackUrl;
    // eSMS blocks a repeated RequestId for 24h. Passing the notification's own
    // id turns a retry — ours or a queue's — into a no-op instead of a second
    // text to the same customer.
    if (message.requestId) body.RequestId = String(message.requestId).slice(0, 50);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        CodeResult?: string; SMSID?: string; ErrorMessage?: string;
      };

      if (data?.CodeResult === '100') {
        // Accepted by eSMS. NOT yet delivered — see the note at the top.
        return { success: true, providerMessageId: data.SMSID };
      }

      const err = describeCode(String(data?.CodeResult ?? res.status), data?.ErrorMessage);
      logger.warn(`SMS tới ${to} thất bại — ${err}`);
      return { success: false, error: err.slice(0, 300) };
    } catch (err) {
      logger.error(`SMS tới ${to} lỗi: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
