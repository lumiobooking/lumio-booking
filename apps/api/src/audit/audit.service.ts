import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { botRelevantAction, requestBotCatchUp } from '../messenger/bot-refresh';

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
 * Who else wants to hear about an action once it is written — the restaurant
 * alerts (restaurant/night-log.service.ts) register here, so the till's many
 * call sites stay as they are. A listener never slows or breaks the action:
 * it is called without waiting, and anything it throws is swallowed.
 */
type AuditListener = (input: AuditLogInput, at: Date) => unknown;
const listeners: AuditListener[] = [];
export function addAuditListener(fn: AuditListener): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
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
    const at = new Date();
    for (const fn of listeners) {
      try { void Promise.resolve(fn(input, at)).catch(() => undefined); } catch { /* never breaks the action */ }
    }
    // A change the bot should know about: it re-reads the salon's open
    // conversations and answers what it can now (see messenger/bot-refresh.ts).
    if (input.tenantId && botRelevantAction(input.action)) requestBotCatchUp(input.tenantId, input.action);
  }
}
