import { Controller, Get, Logger, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SUPPORT_ROLE } from '../support/support.service';
import { PrismaService } from '../prisma/prisma.service';
import { BotReportService } from './bot-report.service';

/**
 * Platform check, never a salon's screen: did the AI ever send a customer a
 * reply that talked about a correction note (./correction-guard)? Support and
 * Super Admin only — it reads across salons. Read only, and audited.
 */
@Controller('support/ai-leaks')
@Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
export class SupportAiLeaksController {
  private readonly logger = new Logger('SupportAiLeaks');
  constructor(private readonly reports: BotReportService, private readonly prisma: PrismaService) {}

  @Get()
  async scan(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    const out = await this.reports.leakScan(Number(days));
    this.logger.log(`leak scan by ${user.userId}: ${out.hits.length} hit(s) in ${out.threads} thread(s), ${out.days} days`);
    // One audit row per salon whose conversations were shown (tenant_id is required on the log).
    for (const tenantId of Array.from(new Set(out.hits.map((h) => h.tenantId)))) {
      await this.prisma.auditLog.create({ data: { tenantId, userId: user.userId ?? null, action: 'support.ai_leak_scan', resourceType: 'messenger_thread', resourceId: 'scan' } }).catch(() => undefined);
    }
    return out;
  }
}
