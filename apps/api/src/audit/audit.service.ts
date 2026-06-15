import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  tenantId?: string | null;
  userId?: string | null;
  action: string; // e.g. "tenant.created", "tenant.suspended"
  resourceType?: string; // e.g. "tenant"
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}

/**
 * Writes important actions to the audit_logs table. tenantId/userId are
 * nullable so platform-level SUPER_ADMIN actions are also captured. Failures
 * are swallowed (logged only) so auditing never breaks the main operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
          action: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          metadata: input.metadata ?? {},
          ipAddress: input.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log "${input.action}": ${String(err)}`);
    }
  }
}
