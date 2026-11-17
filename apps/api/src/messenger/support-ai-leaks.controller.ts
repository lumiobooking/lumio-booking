import { Controller, Get, Logger, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SUPPORT_ROLE } from '../support/support.service';
import { PrismaService } from '../prisma/prisma.service';
import { BotReportService } from './bot-report.service';
import { sharedAiHealth } from './ai-health';
import { presenceStats } from './presence';

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

  /**
   * Why the AI last failed, with the provider's own words (status and the
   * start of its answer). The public /health hides that line because it can
   * quote a message; support needs it to tell "wrong model name" from
   * "overloaded" without the server's logs. Platform state, no salon's data.
   */
  @Get('health')
  health() {
    const h = sharedAiHealth();
    // "Seen" + typing dots sent to Meta since this server started (./presence): proof the calls arrive.
    const presence = () => { const p = presenceStats(); return { sent: p.sent, failed: p.failed, lastError: p.lastError, lastOkAt: p.lastOkAt ? new Date(p.lastOkAt).toISOString() : null, lastFailAt: p.lastFailAt ? new Date(p.lastFailAt).toISOString() : null }; };
    return { streak: h.streak, replies: h.okCount, failures: h.failCount, lastKind: h.lastKind, lastDetail: h.lastDetail, lastOkAt: h.lastOkAt ? new Date(h.lastOkAt).toISOString() : null, lastFailAt: h.lastFailAt ? new Date(h.lastFailAt).toISOString() : null, hardModel: String(process.env.ANTHROPIC_HARD_MODEL ?? '').trim() || null, presence: presence() };
  }
}

/**
 * The platform's AI health: one row of numbers per salon (./ai-fleet) — speed,
 * failures, customers still waiting, AI on or off. Support and Super Admin
 * only: it names every salon, which no salon-scoped screen may do. Read only,
 * audited, and it carries counts — never a message or a customer's name.
 */
@Controller('support/ai-fleet')
@Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
export class SupportAiFleetController {
  constructor(private readonly reports: BotReportService, private readonly prisma: PrismaService) {}

  @Get()
  async fleet(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    const out = await this.reports.fleet(Number(days));
    await this.prisma.auditLog.create({ data: { tenantId: null, userId: user.userId ?? null, action: 'support.ai_fleet_viewed', resourceType: 'platform', resourceId: `days:${out.days}` } }).catch(() => undefined);
    return out;
  }
}
