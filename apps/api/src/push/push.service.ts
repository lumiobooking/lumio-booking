import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// `web-push` is declared in package.json and installed on Render. It's required
// lazily (not `import`) so the sandbox typecheck — which can't reach the npm
// registry — still compiles; it resolves at runtime on the server.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let webpush: any = null;
try { webpush = require('web-push'); } catch { webpush = null; }

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Web Push (RFC 8291) sender. Notifications reach the owner's phone even when
 * the app is CLOSED. Disabled (no-op) unless VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
 * are set, so nothing breaks until you turn it on. Tenant-scoped subscriptions.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (webpush && pub && priv) {
      try {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@lumiobooking.com', pub, priv);
        this.configured = true;
      } catch (e) {
        this.logger.warn('VAPID setup failed: ' + String(e));
      }
    }
  }

  enabled(): boolean { return this.configured; }
  publicKey(): string { return process.env.VAPID_PUBLIC_KEY || ''; }

  async saveSubscription(tenantId: string, userId: string, sub: PushSub): Promise<void> {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return;
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { tenantId, userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { tenantId, userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async removeSubscription(endpoint: string): Promise<void> {
    if (!endpoint) return;
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Fire a push to every device subscribed for this salon. Never throws. */
  async sendToTenant(tenantId: string, payload: { title: string; body: string; url?: string }): Promise<void> {
    if (!this.configured) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { tenantId } }).catch(() => [] as Array<{ endpoint: string; p256dh: string; auth: string }>);
    const data = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || '/salon/activity' });
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
      } catch (err: any) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => undefined);
        }
      }
    }));
  }
}
