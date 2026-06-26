import { Logger } from '@nestjs/common';
import { SendResult, SmsMessage, SmsProvider } from './notification-provider.interface';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  // Prefer a Messaging Service (handles STOP/HELP + sticky sender). Otherwise a
  // single From number (E.164, e.g. +18337195153).
  messagingServiceSid?: string;
  fromNumber?: string;
}

const logger = new Logger('TwilioSms');

/**
 * Real SMS over Twilio's REST API
 * (POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json).
 *
 * Platform-level credentials come from environment variables (one Twilio
 * account for the whole platform); the salon's own name is already inside the
 * message body, so recipients always know who is texting them. Never throws —
 * returns a SendResult the NotificationsService records as SENT/FAILED.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(private readonly config: TwilioConfig) {}

  async sendSms(message: SmsMessage): Promise<SendResult> {
    const to = toE164(message.to);
    if (!to) return { success: false, error: `Invalid phone number: "${message.to}"` };

    const params = new URLSearchParams();
    params.set('To', to);
    params.set('Body', message.body);
    if (this.config.messagingServiceSid) params.set('MessagingServiceSid', this.config.messagingServiceSid);
    else if (this.config.fromNumber) params.set('From', this.config.fromNumber);
    else return { success: false, error: 'No Twilio sender (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER)' };

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: params.toString(),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (res.ok) return { success: true, providerMessageId: data?.sid };
      const err = data?.message ? `Twilio ${data.code ?? res.status}: ${data.message}` : `Twilio HTTP ${res.status}`;
      logger.warn(`SMS to ${to} failed — ${err}`);
      return { success: false, error: err.slice(0, 300) };
    } catch (err) {
      logger.error(`SMS to ${to} threw: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}

/**
 * Normalise a phone number to E.164 (what Twilio requires). Customers type
 * numbers like "(201) 555-0123"; assume US/Canada (+1) for 10-digit input.
 * Returns null when the number is implausible (caller records it as FAILED).
 */
export function toE164(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed; // already E.164
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`; // US/CA local
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`; // 1XXXXXXXXXX
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`; // intl, already with country code
  return null;
}
