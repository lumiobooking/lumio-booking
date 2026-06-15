import { Logger } from '@nestjs/common';
import { EmailMessage, EmailProvider, SendResult } from './notification-provider.interface';

export interface BrevoConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

const logger = new Logger('BrevoEmail');

/**
 * Transactional email over Brevo's HTTPS API (https://api.brevo.com/v3/smtp/email).
 * Works from cloud hosts where outbound SMTP ports (465/587) are blocked or
 * time out — which is the common failure mode for Gmail SMTP on platforms.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo';

  constructor(private readonly config: BrevoConfig) {}

  async sendEmail(message: EmailMessage): Promise<SendResult> {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.config.senderEmail, name: this.config.senderName || 'Lumio Booking' },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html || `<p>${message.body}</p>`,
          textContent: message.body,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { messageId?: string };
        return { success: true, providerMessageId: data?.messageId };
      }
      const errText = await res.text().catch(() => '');
      return { success: false, error: `Brevo ${res.status}: ${errText.slice(0, 300)}` };
    } catch (err) {
      logger.error(`Brevo send to ${message.to} failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
