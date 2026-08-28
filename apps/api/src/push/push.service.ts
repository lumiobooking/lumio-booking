import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pushAudience, isDeadEndpoint } from '../notifications/push-payload';

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

  /**
   * Fire a push to every device subscribed for this salon. Never throws.
   *
   * `exceptUserId` skips the person who caused the event. It was added for the
   * inbox: a technician who has just typed a reply does not need their own
   * phone buzzing at them, and being buzzed by your own message is the fastest
   * way to make somebody switch notifications off for good.
   *
   * `tag` lets a caller decide what replaces what on the lock screen. Bookings
   * and inbox messages are different queues and should not overwrite each other.
   */
  async sendToTenant(
    tenantId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
    opts: { exceptUserId?: string | null } = {},
  ): Promise<void> {
    if (!this.configured) return;
    // Typed explicitly rather than inferred: a `select` narrows the row type,
    // and the sandbox's generated Prisma client is old enough to infer `{}`
    // here — which compiles into implicit-any downstream and then fails on the
    // real build. Naming the shape once makes both agree.
    type SubRow = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };
    const subs: SubRow[] = await this.prisma.pushSubscription
      .findMany({ where: { tenantId }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } })
      .catch(() => []) as unknown as SubRow[];

    // Who to wake, and never the same device twice. See push-payload.spec.ts.
    const targets = pushAudience(subs, { exceptUserId: opts.exceptUserId ?? null });
    const byEndpoint = new Map<string, SubRow>(subs.map((s: SubRow) => [s.endpoint, s]));
    const data = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/salon/activity',
      tag: payload.tag || 'lumio-booking',
    });

    await Promise.all(targets.map(async (t) => {
      const s = byEndpoint.get(t.endpoint);
      if (!s) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
      } catch (err: any) {
        // 404/410 only. A 429 or a 500 is the push service having a bad
        // minute, and deleting a device for that silently unsubscribes
        // somebody who never asked to be unsubscribed.
        if (isDeadEndpoint(err && err.statusCode)) {
          await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => undefined);
        }
      }
    }));
  }
}
