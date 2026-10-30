import { Logger } from '@nestjs/common';
import { toE164 } from '../../common/phone';
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
 * The sender in the E.164 form Twilio requires.
 *
 * A North-American number typed the local way — "(833) 719-5153",
 * " 8337195153" — is +1 whatever the salon's country. It used to be put in
 * +61 form for an Australian salon ("+8337195153"), which Twilio refused
 * with error 21212 on every text: the owner's new-booking alert and every
 * customer text from those salons. Only a number that is NOT North-American
 * ("0485 085 339") takes the salon's own dial code. Anything that cannot be
 * read is passed through unchanged, for Twilio to judge.
 */
export function normalizeFrom(raw: string, salonDial = '1'): string {
  const t = String(raw ?? '').trim();
  if (!t) return t;
  if (/^MG[0-9a-f]{32}$/i.test(t)) return t;
  const digits = t.replace(/\D/g, '');
  if (t.startsWith('+')) return digits ? `+${digits}` : t;
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && /^1[2-9]\d{2}[2-9]/.test(digits)) return `+${digits}`;
  return toE164(t, salonDial) ?? t;
}

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
    const to = toE164(message.to, message.defaultDialCode);
    if (!to) return { success: false, error: `Invalid phone number: "${message.to}"` };

    const params = new URLSearchParams();
    params.set('To', to);
    params.set('Body', message.body);
    // Twilio reports delivered / undelivered here (NotificationsService
    // .applyTwilioStatus) — how a dead number stops being texted.
    if (message.statusCallback) params.set('StatusCallback', message.statusCallback);
    if (this.config.messagingServiceSid) params.set('MessagingServiceSid', this.config.messagingServiceSid);
    else if (this.config.fromNumber) {
      const from = normalizeFrom(this.config.fromNumber, String(message.defaultDialCode ?? '1'));
      params.set('From', from);
    }
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
