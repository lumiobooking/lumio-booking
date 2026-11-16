import { Controller, Get, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { SUPPORT_ROLE } from '../support/support.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { AiBrainService } from './ai-brain.service';
import { CANARY_KEY, canaryDue, canaryFrom, canaryPush, canarySlug, canaryVerdict, type CanaryRecord } from './ai-canary';

/** Runs the canary (./ai-canary) a few minutes after this build starts serving. */
@Injectable()
export class AiCanaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AiCanary');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brain: AiBrainService,
    @Optional() private readonly push?: PushService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'production' || !canarySlug()) return;
    // After the deploy has settled and the first customers are being served — never in their way.
    this.timer = setTimeout(() => void this.run().catch((e) => this.logger.warn(`canary failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`)), 4 * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearTimeout(this.timer); }

  async last(): Promise<CanaryRecord | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: CANARY_KEY } }).catch(() => null);
    return canaryFrom(row?.value);
  }

  private async keep(rec: CanaryRecord): Promise<void> {
    const value = JSON.stringify(rec);
    await this.prisma.platformConfig.upsert({ where: { key: CANARY_KEY }, create: { key: CANARY_KEY, value }, update: { value } });
  }

  async run(commit = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7)): Promise<CanaryRecord | null> {
    const slug = canarySlug();
    if (!slug) return null;
    const before = await this.last();
    if (!canaryDue(commit, before)) return null;
    const tenant = await this.prisma.tenant.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }).catch(() => null);
    if (!tenant) { this.logger.log(`canary skipped: no salon "${slug}"`); return null; }
    // Claimed first: a second instance of the same build reads it as taken.
    await this.keep({ commit, at: new Date().toISOString(), state: 'running' });
    // The platform itself, acting inside its OWN demo salon — the sandbox books and sends nothing.
    const actor = { userId: null, role: UserRole.SALON_ADMIN, tenantId: tenant.id } as unknown as AuthenticatedUser;
    try {
      const r = await this.brain.runSimulations(actor, 'vi');
      const failed = r.items.filter((x) => !x.pass).map((x) => `${x.id}:${x.lang}`);
      const rec: CanaryRecord = { commit, at: new Date().toISOString(), state: 'done', passed: r.passed, total: r.total, failed };
      await this.keep(rec);
      const v = canaryVerdict({ passed: r.passed, total: r.total }, before);
      this.logger.log(`canary ${commit}: ${r.passed}/${r.total}${v.alert ? ` — WORSE (${v.why})` : ''}`);
      if (v.alert && this.push) await this.push.sendToTeam(canaryPush(commit, { passed: r.passed, total: r.total }, v.why, failed)).catch(() => undefined);
      return rec;
    } catch (e) {
      const rec: CanaryRecord = { commit, at: new Date().toISOString(), state: 'error', error: String((e as Error)?.message ?? e).slice(0, 200) };
      await this.keep(rec).catch(() => undefined);
      return rec;
    }
  }
}

/** The last canary result, for the platform team only. */
@Controller('support/ai-canary')
@Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
export class AiCanaryController {
  constructor(private readonly canary: AiCanaryService) {}

  @Get()
  last() { return this.canary.last(); }
}
