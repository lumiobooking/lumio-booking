import { Logger } from '@nestjs/common';
import { SendResult } from './notification-provider.interface';
import { describeCode, toVietnamLocal } from './esms.provider';

/**
 * Zalo ZNS (Zalo Notification Service), through eSMS — the same aggregator,
 * keys and wallet the salon's Vietnamese SMS already uses.
 *
 * WHY ZNS AT ALL
 *
 * A ZNS message lands inside Zalo — the app a Vietnamese customer actually
 * has open — costs roughly half of a brandname SMS, and can carry buttons and
 * structured fields. But it only reaches phones with Zalo, and only through a
 * TEMPLATE that Zalo approved beforehand for that Official Account. So ZNS is
 * never the only path: the caller tries ZNS first and falls back to SMS, and
 * a misconfigured template costs the salon nothing but the discount.
 *
 * THE TEMPLATE CONTRACT
 *
 * Zalo validates TempData against the registered template's parameters — an
 * unknown or missing key is a rejected send. This class sends EXACTLY the
 * params it is given, so the contract lives with the caller: Lumio's canonical
 * booking params are customer_name, salon_name, service_name,
 * appointment_date, appointment_time — the salon registers its ZNS templates
 * with exactly those names (the setup guide says so), or the send fails and
 * the SMS fallback delivers instead.
 *
 * ZNS is transactional-only BY ZALO'S RULES: advertising content is rejected
 * at template review. Remarketing does not belong here and never will —
 * that is OA broadcast messages (followers) or batched advertising SMS.
 *
 * Like SMS, CodeResult 100 means "eSMS accepted it" — NOT delivered. The real
 * outcome arrives on the same CallbackUrl (TypeId 24-26), settles the same
 * notification row, found by the same SMSID.
 */

export interface ZnsConfig {
  apiKey: string;
  secretKey: string;
  /** Zalo Official Account id, linked to eSMS by the salon. */
  oaid: string;
  callbackUrl?: string;
  /** '1' sends nothing and charges nothing — for verifying wiring. */
  sandbox?: boolean;
}

export interface ZnsMessage {
  to: string;
  /** The Zalo-approved template id, registered per-OA through eSMS. */
  tempId: string;
  /** Must match the registered template's parameter names exactly. */
  params: Record<string, string>;
  /** Idempotency key — same 24h no-op contract as eSMS SMS RequestId. */
  requestId?: string;
}

const logger = new Logger('Zns');

const ENDPOINT = 'https://rest.esms.vn/MainService.svc/json/SendZaloMessage_V6/';

export class ZnsProvider {
  readonly name = 'zalo-zns';

  constructor(private readonly config: ZnsConfig) {}

  async sendZns(message: ZnsMessage): Promise<SendResult> {
    const to = toVietnamLocal(message.to);
    if (!to) return { success: false, error: `Số điện thoại không hợp lệ cho Việt Nam: "${message.to}"` };
    if (!this.config.oaid || !message.tempId) {
      return { success: false, error: 'Chưa cấu hình OAID / Template ID cho Zalo ZNS' };
    }

    const body: Record<string, unknown> = {
      ApiKey: this.config.apiKey,
      SecretKey: this.config.secretKey,
      OAID: this.config.oaid,
      Phone: to,
      TempID: message.tempId,
      TempData: message.params ?? {},
    };
    if (this.config.sandbox) body.Sandbox = '1';
    if (this.config.callbackUrl) body.CallbackUrl = this.config.callbackUrl;
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
        // Accepted by eSMS — the delivery callback settles the rest.
        return { success: true, providerMessageId: data.SMSID };
      }

      const err = String(data?.CodeResult) === '789'
        ? 'Zalo ZNS: Template ID chưa được cấu hình cho OA này (eSMS 789)'
        : describeCode(String(data?.CodeResult ?? res.status), data?.ErrorMessage);
      logger.warn(`ZNS tới ${to} thất bại — ${err} (sẽ chuyển qua SMS)`);
      return { success: false, error: err.slice(0, 300) };
    } catch (err) {
      logger.error(`ZNS tới ${to} lỗi: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
