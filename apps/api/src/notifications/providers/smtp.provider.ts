import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailProvider, SendResult } from './notification-provider.interface';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string; // e.g. 'Salon Name <salon@gmail.com>'
  // Encryption (Amelia-style): 'ssl' (implicit TLS, port 465),
  // 'tls' (STARTTLS, port 587), 'none' (plain, port 25). Defaults from port.
  secure?: 'ssl' | 'tls' | 'none';
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
      // Resolve encryption: explicit `secure` wins; otherwise infer from port.
      const mode = this.config.secure ?? (this.config.port === 465 ? 'ssl' : this.config.port === 587 ? 'tls' : 'none');
      const transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: mode === 'ssl', // implicit TLS
        requireTLS: mode === 'tls', // STARTTLS
        auth: { user: this.config.user, pass: this.config.pass },
        // Fail fast instead of hanging forever when the network/port blocks SMTP.
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
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
