import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pushAudience, isDeadEndpoint } from '../notifications/push-payload';
import { UserRole } from '@prisma/client';
import { capabilitiesFor } from '../auth/capabilities';
import { FCM_PREFIX, FcmClient, isFcmEndpoint, loadServiceAccount } from './fcm';

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
  /** Web Push (VAPID) is set up. */
  private configured = false;
  /** The store apps' channel; null until FCM_SERVICE_ACCOUNT_JSON is set. */
  private readonly fcm: FcmClient | null;

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
    const sa = loadServiceAccount();
    this.fcm = sa ? new FcmClient(sa) : null;
    if (!sa && process.env.FCM_SERVICE_ACCOUNT_JSON) this.logger.warn('FCM_SERVICE_ACCOUNT_JSON is set but unreadable — native push off');
  }

  /** True when at least one channel can deliver. */
  enabled(): boolean { return this.configured || Boolean(this.fcm); }
  nativeEnabled(): boolean { return Boolean(this.fcm); }
  publicKey(): string { return process.env.VAPID_PUBLIC_KEY || ''; }

  /**
   * A phone running the store app. Same table as a browser subscription so
   * every audience rule applies unchanged; the endpoint carries the token
   * behind a prefix and the key columns say which platform it is.
   */
  async saveNativeToken(tenantId: string, userId: string, token: string, platform: 'ios' | 'android'): Promise<void> {
    const t = String(token || '').trim();
    if (!t || t.length > 4096) return;
    const endpoint = FCM_PREFIX + t;
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { tenantId, userId, endpoint, p256dh: 'native', auth: platform },
      update: { tenantId, userId, p256dh: 'native', auth: platform },
    });
  }

  async removeNativeToken(token: string): Promise<void> {
    const t = String(token || '').trim();
    if (!t) return;
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint: FCM_PREFIX + t } });
  }

  /** Every device of one person, on every channel. */
  async removeAllForUser(userId: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId } }).catch(() => undefined);
  }

  /**
   * One device, whichever channel it lives on. A dead device (uninstalled
   * app, expired browser subscription) is dropped; a transient failure is
   * not, so nobody is silently unsubscribed by a bad minute at Google.
   */
  private async deliver(s: { endpoint: string; p256dh: string; auth: string }, data: { title: string; body: string; url: string; tag: string }): Promise<void> {
    if (isFcmEndpoint(s.endpoint)) {
      if (!this.fcm) return;
      try {
        const r = await this.fcm.send(s.endpoint.slice(FCM_PREFIX.length), data);
        if (r.dead) await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => undefined);
      } catch (e) {
        this.logger.warn(`fcm send: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    if (!this.configured) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(data));
    } catch (err: any) {
      if (isDeadEndpoint(err && err.statusCode)) {
        await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => undefined);
      }
    }
  }

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
  /**
   * Wake the AGENCY's people, whichever salon their phone subscribed from.
   *
   * A support employee's device is filed under the salon they were inside
   * when they said yes to notifications, so `sendToTenant` from a salon
   * reaches the salon's own staff and, by luck, whoever last worked there.
   * The team is a role, not a tenant: this sends to every device whose owner
   * is a Lumio account (support or super admin), across every salon.
   */
  async sendToTeam(payload: { title: string; body: string; url?: string; tag?: string }): Promise<void> {
    if (!this.enabled()) return;
    type SubRow = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };
    // No relation from subscription to user in the schema: two reads.
    const team = await this.prisma.user
      .findMany({ where: { role: { in: ['SUPPORT', 'SUPER_ADMIN'] as never[] }, isActive: true } as never, select: { id: true }, take: 500 })
      .catch(() => []) as { id: string }[];
    if (!team.length) return;
    const subs: SubRow[] = await this.prisma.pushSubscription
      .findMany({
        where: { userId: { in: team.map((u) => u.id) } },
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      })
      .catch(() => []) as unknown as SubRow[];
    const targets = pushAudience(subs, { exceptUserId: null });
    const byEndpoint = new Map<string, SubRow>(subs.map((s: SubRow) => [s.endpoint, s]));
    const data = { title: payload.title, body: payload.body, url: payload.url || '/agency', tag: payload.tag || 'lumio-team' };
    await Promise.all(targets.map(async (t) => {
      const s = byEndpoint.get(t.endpoint);
      if (s) await this.deliver(s, data);
    }));
  }

  /**
   * Wake ONE person's devices in this salon — "you have a chat turn".
   * Scoped by tenant AND user, so a person who also works at another salon is
   * only woken by the salon the turn belongs to.
   */
  /** This person's registered devices, split by how they are reached. */
  async countForUser(tenantId: string, userId: string): Promise<{ web: number; native: number }> {
    const rows = await this.prisma.pushSubscription
      .findMany({ where: { tenantId, userId }, select: { endpoint: true } })
      .catch(() => []) as unknown as { endpoint: string }[];
    const uniq = [...new Set(rows.map((r) => r.endpoint))];
    const native = uniq.filter((e) => isFcmEndpoint(e)).length;
    return { web: uniq.length - native, native };
  }

  /** Returns how many devices were addressed (0 when push is off or none registered). */
  async sendToUser(
    tenantId: string,
    userId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ): Promise<number> {
    if (!this.enabled() || !tenantId || !userId) return 0;
    type SubRow = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };
    const subs: SubRow[] = await this.prisma.pushSubscription
      .findMany({ where: { tenantId, userId }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } })
      .catch(() => []) as unknown as SubRow[];
    const seen = new Set<string>();
    const data = { title: payload.title, body: payload.body, url: payload.url || '/salon/inbox', tag: payload.tag || 'lumio-chat-turn' };
    const targets = subs.filter((s) => !seen.has(s.endpoint) && seen.add(s.endpoint));
    await Promise.all(targets.map((s) => this.deliver(s, data)));
    return targets.length;
  }

  /** Logins of this salon that are staff with no desk permission at all (a technician's own app). */
  private async techOnlyUsers(tenantId: string, userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Set();
    try {
      const [users, staff] = await Promise.all([
        this.prisma.user.findMany({ where: { tenantId, id: { in: ids }, role: UserRole.STAFF }, select: { id: true } }),
        this.prisma.staffMember.findMany({ where: { tenantId, userId: { in: ids } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as Promise<{ userId: string | null; staffRole: string | null; permissions?: unknown }[]>,
      ]);
      const out = new Set<string>();
      for (const u of users) {
        const sm = staff.find((x) => x.userId === u.id);
        if (capabilitiesFor(UserRole.STAFF, (sm?.staffRole ?? 'TECHNICIAN') as never, sm?.permissions).length === 0) out.add(u.id);
      }
      return out;
    } catch { return new Set(); }
  }

  async sendToTenant(
    tenantId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
    opts: { exceptUserId?: string | null; onlyUserIds?: string[] } = {},
  ): Promise<void> {
    if (!this.enabled()) return;
    if (opts.onlyUserIds && !opts.onlyUserIds.length) return;
    // Typed explicitly rather than inferred: a `select` narrows the row type,
    // and the sandbox's generated Prisma client is old enough to infer `{}`
    // here — which compiles into implicit-any downstream and then fails on the
    // real build. Naming the shape once makes both agree.
    type SubRow = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };
    const subs: SubRow[] = await this.prisma.pushSubscription
      .findMany({ where: { tenantId, ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}) }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } })
      .catch(() => []) as unknown as SubRow[];

    // A salon-wide alert (new booking, a customer wrote…) is for the people who
    // run the salon. A technician's login with no desk permission gets her OWN
    // alerts (sendToUser: a customer for her, her booking) — not every booking
    // in the salon with the customer's name on her lock screen.
    const quiet = opts.onlyUserIds ? new Set<string>() : await this.techOnlyUsers(tenantId, subs.map((x) => x.userId));
    // Who to wake, and never the same device twice. See push-payload.spec.ts.
    const targets = pushAudience(subs.filter((x) => !quiet.has(x.userId)), { exceptUserId: opts.exceptUserId ?? null });
    const byEndpoint = new Map<string, SubRow>(subs.map((s: SubRow) => [s.endpoint, s]));
    const data = {
      title: payload.title,
      body: payload.body,
      url: payload.url || '/salon/activity',
      tag: payload.tag || 'lumio-booking',
    };

    await Promise.all(targets.map(async (t) => {
      const s = byEndpoint.get(t.endpoint);
      if (s) await this.deliver(s, data);
    }));
  }
}
