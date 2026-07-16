import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Platform-level config (payment gateway keys etc.) stored in the DB so the
 * Super Admin can manage them in-app. Each key falls back to the matching env
 * var when not set in the DB, so existing Render env configuration keeps working.
 */
@Injectable()
export class PlatformConfigService {
  // Maps a config key to its env-var fallback.
  static readonly ENV_FALLBACK: Record<string, string> = {
    stripe_secret_key: 'STRIPE_SECRET_KEY',
    stripe_webhook_secret: 'STRIPE_WEBHOOK_SECRET',
    paypal_client_id: 'PAYPAL_CLIENT_ID',
    paypal_secret: 'PAYPAL_SECRET',
    paypal_webhook_id: 'PAYPAL_WEBHOOK_ID',
    paypal_env: 'PAYPAL_ENV',
    app_url: 'APP_URL',
    // Platform email (Brevo) used to send invoices FROM Lumio to salons.
    brevo_api_key: 'BREVO_API_KEY',
    brevo_sender_email: 'BREVO_SENDER_EMAIL',
    brevo_sender_name: 'BREVO_SENDER_NAME',
    // Logo shown at the top of Lumio's own emails (invoices + marketing campaigns).
    brand_logo_url: 'BRAND_LOGO_URL',
    // Where a customer's reply lands when they hit "Reply". The sender address is a
    // no-reply domain address verified in Brevo; this is the human inbox we actually
    // read. Without it, replies would go back to the sending address and be lost.
    reply_to: 'BRAND_REPLY_TO',
    // Auto-detecting replies: a subdomain whose MX points at Brevo Inbound Parsing.
    // Replies land there, Brevo posts them to our webhook, and the contact is
    // marked as 'replied' — which permanently stops the follow-up robot.
    inbound_domain: 'INBOUND_DOMAIN',
    inbound_token: 'INBOUND_TOKEN',
    inbound_forward_to: 'INBOUND_FORWARD_TO',
    // Image storage over FTP/FTPS (e.g. Hostinger public_html) so uploaded photos
    // live on the salon's own hosting/CDN instead of bloating the database.
    storage_ftp_host: 'STORAGE_FTP_HOST',
    storage_ftp_port: 'STORAGE_FTP_PORT',
    storage_ftp_user: 'STORAGE_FTP_USER',
    storage_ftp_pass: 'STORAGE_FTP_PASS',
    storage_ftp_secure: 'STORAGE_FTP_SECURE',      // 'true' = FTPS (explicit TLS)
    storage_ftp_base_path: 'STORAGE_FTP_BASE_PATH', // e.g. /public_html/uploads
    storage_public_base: 'STORAGE_PUBLIC_BASE',     // e.g. https://lumioagency.com/uploads
  };

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  /** DB value first, else the env fallback, else undefined. */
  async get(key: string): Promise<string | undefined> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (row?.value) return row.value;
    const env = PlatformConfigService.ENV_FALLBACK[key];
    return env ? this.config.get<string>(env) : undefined;
  }

  /** Upsert several keys at once. Empty/undefined values are skipped (kept). */
  async setMany(updates: Record<string, string | undefined | null>): Promise<void> {
    const entries = Object.entries(updates).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
    for (const [key, value] of entries) {
      await this.prisma.platformConfig.upsert({
        where: { key },
        create: { key, value: (value as string).trim() },
        update: { value: (value as string).trim() },
      });
    }
  }

  /** Which keys currently have a value (DB or env) — for showing "connected" UI. */
  async present(keys: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const k of keys) out[k] = !!(await this.get(k));
    return out;
  }
}
