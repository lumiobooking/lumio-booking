/**
 * Provider abstraction for notifications. The rest of the app depends only on
 * these interfaces, so swapping the mock for SendGrid/Resend/SES (email) or
 * Twilio (SMS) later is a drop-in change with no business-logic edits. Real
 * provider credentials always come from environment variables — never code.
 */

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string; // plain-text fallback
  html?: string; // optional rich HTML body
}

export interface SmsMessage {
  to: string;
  body: string;
  /** Country calling code to assume when `to` is written in local form, e.g.
   *  '84' for a Vietnamese salon. Omitted → '1', which is what every US and
   *  Canadian salon has always used. */
  defaultDialCode?: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(message: SmsMessage): Promise<SendResult>;
}
