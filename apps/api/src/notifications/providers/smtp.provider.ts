import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailProvider, SendResult } from './notification-provider.interface';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string; // e.g. 'Salon Name <salon@gmail.com>'
}

const logger = new Logger('SmtpEmail');

/**
 * Real email delivery over SMTP (e.g. Gmail with an App Password). Built per
 * send from the salon's own credentials. Port 465 = implicit SSL; 587 = STARTTLS.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  constructor(private readonly config: SmtpConfig) {}

  async sendEmail(message: EmailMessage): Promise<SendResult> {
    try {
      const transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: { user: this.config.user, pass: this.config.pass },
      });
      const info = await transporter.sendMail({
        from: this.config.from || this.config.user,
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (err) {
      logger.error(`SMTP send to ${message.to} failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
