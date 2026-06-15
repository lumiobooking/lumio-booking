import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
