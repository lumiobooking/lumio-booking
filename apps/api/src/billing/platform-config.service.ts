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
