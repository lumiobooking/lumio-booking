import { Logger } from '@nestjs/common';
import { EmailMessage, EmailProvider, SendResult } from './notification-provider.interface';

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string; // the authorised Gmail address (the "From" address)
  senderName?: string;
  replyTo?: string;
}

const logger = new Logger('GmailOAuth');

/**
 * Sends email through the Gmail API over HTTPS using OAuth2 — the same mechanism
 * as WP Mail SMTP's "Google / Gmail" mailer. Because it uses HTTPS (not SMTP
 * ports 465/587) it works on hosts that block outbound SMTP (e.g. Render free),
 * is free (Gmail ~500/day, Workspace ~2000/day) and sends from a real Gmail
 * address, so deliverability is excellent and the From info is never wrong.
 *
 * Credentials come from a Google Cloud OAuth client + a one-time refresh token.
 */
export class GmailOAuthProvider implements EmailProvider {
  readonly name = 'gmail';

  constructor(private readonly config: GmailOAuthConfig) {}

  private async accessToken(): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`token ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('no access_token returned');
    return data.access_token;
  }

  /** base64url without padding, as required by the Gmail API "raw" field. */
  private b64url(input: Buffer): string {
    return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Encode a header value that may contain non-ASCII (e.g. salon name). */
  private encodeHeader(value: string): string {
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
  }

  private buildMime(message: EmailMessage): string {
    const fromName = this.config.senderName ? `${this.encodeHeader(this.config.senderName)} ` : '';
    const headers = [
      `From: ${fromName}<${this.config.senderEmail}>`,
      `To: ${message.to}`,
      this.config.replyTo ? `Reply-To: ${this.config.replyTo}` : '',
      `Subject: ${this.encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].filter(Boolean);
    const htmlBody = message.html || `<p>${message.body}</p>`;
    // base64-encode the body in 76-char lines (RFC 2045).
    const encoded = Buffer.from(htmlBody, 'utf-8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
  }

  async sendEmail(message: EmailMessage): Promise<SendResult> {
    try {
      const token = await this.accessToken();
      const raw = this.b64url(Buffer.from(this.buildMime(message), 'utf-8'));
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { success: true, providerMessageId: data?.id };
      }
      const errText = await res.text().catch(() => '');
      return { success: false, error: `Gmail ${res.status}: ${errText.slice(0, 300)}` };
    } catch (err) {
      logger.error(`Gmail send to ${message.to} failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
