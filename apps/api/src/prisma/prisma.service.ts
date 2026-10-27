import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { liveEvents } from '../common/live-events';
import { liveTopicOf, tenantOfWrite } from '../common/live-writes';

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
      try {
        const topic = liveTopicOf(params as never);
        if (topic) liveEvents.emit(tenantOfWrite(params as never, result), topic);
      } catch { /* a nudge is best-effort */ }
      return result;
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
