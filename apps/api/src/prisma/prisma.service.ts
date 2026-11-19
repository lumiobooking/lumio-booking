import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { liveEvents } from '../common/live-events';
import { liveTopicOf, tenantOfWrite } from '../common/live-writes';
import { historyWrite, logRowsFrom } from '../messenger/message-log';
import { inboxBus, inboxWrite, tenantOf } from '../messenger/inbox-events';

/**
 * Thin wrapper around PrismaClient so it can be injected anywhere via Nest DI.
 *
 * IMPORTANT (multi-tenant): this service exposes the raw client. Tenant
 * isolation is NOT enforced here automatically. Every tenant-scoped query in a
 * service/repository MUST include `where: { tenantId }` taken from the
 * authenticated request context. A TenantContext guard/middleware (added in
 * Step 3) supplies that tenantId, and repository helpers will enforce it so a
 * developer cannot accidentally query across tenants.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Realtime: after a write to a table a live screen shows, nudge that
    // salon's open screens (common/live-writes.ts). After the write, never
    // inside it; a failure here can never fail the write.
    const self = this as unknown as { $use?: (mw: (params: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void };
    self.$use?.(async (params, next) => {
      const result = await next(params);
      try { this.logHistory(params, result); } catch { /* the permanent log is best-effort per write; the next write fills a gap */ }
      try { this.nudgeInbox(params, result); } catch { /* a nudge is best-effort; the screen's safety poll covers a miss */ }
      try {
        const topic = liveTopicOf(params as never);
        if (topic) {
          const tenant = tenantOfWrite(params as never, result);
          // Inside a transaction the write is not visible to other readers
          // until it commits: a screen nudged now could read the old state.
          // Give the commit a moment; outside one, nudge at once.
          if ((params as { runInTransaction?: boolean }).runInTransaction) setTimeout(() => liveEvents.emit(tenant, topic), 400);
          else liveEvents.emit(tenant, topic);
        }
      } catch { /* a nudge is best-effort */ }
      return result;
    });
  }

  /**
   * rt204: every write of a conversation's history also records its newest
   * messages in the permanent log (messenger/message-log). After the write,
   * never inside it, and never able to fail it.
   */
  private logHistory(params: unknown, result: unknown): void {
    const history = historyWrite(params as never);
    if (!history) return;
    void (async () => {
      const p = params as { args?: { where?: { id?: string; tenantId?: string } } };
      const r = (result && typeof result === 'object' ? result : {}) as { id?: string; tenantId?: string };
      const threadId = r.id || p.args?.where?.id;
      if (!threadId || typeof threadId !== 'string') return;
      let tenantId = r.tenantId || p.args?.where?.tenantId;
      if (!tenantId || typeof tenantId !== 'string') {
        const row = await this.messengerThread.findUnique({ where: { id: threadId }, select: { tenantId: true } }).catch(() => null);
        tenantId = row?.tenantId;
      }
      if (!tenantId) return;
      const rows = logRowsFrom(tenantId, threadId, history);
      if (rows.length) await (this as unknown as { messengerMessageLog: { createMany: (a: unknown) => Promise<unknown> } }).messengerMessageLog.createMany({ data: rows, skipDuplicates: true });
    })().catch(() => undefined);
  }

  /** rt205: any write to the conversation tables tells that salon's open inboxes at once (messenger/inbox-events). */
  private nudgeInbox(params: unknown, result: unknown): void {
    if (!inboxWrite(params as never)) return;
    const p = params as { model?: string; args?: { where?: { id?: unknown } } };
    const kind = p.model === 'MessengerThread' ? 'message' : 'thread';
    const t = tenantOf(params as never, result);
    if (t) { inboxBus.emit('nudge', t, kind); return; }
    const id = p.args?.where?.id;
    if (p.model === 'MessengerThread' && typeof id === 'string') {
      void this.messengerThread.findUnique({ where: { id }, select: { tenantId: true } }).then((r) => { if (r?.tenantId) inboxBus.emit('nudge', r.tenantId, kind); }).catch(() => undefined);
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
