import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { BotReportService } from './bot-report.service';
import { DIGEST_KEY, digestDue, digestPush, digestSettingFrom } from './ai-digest';

/**
 * The Monday AI digest (./ai-digest): the per-salon switch, and the hourly
 * sweep that sends it. Each salon's digest is built from THAT salon's rows
 * and goes to THAT salon's owner(s) only.
 */
@Injectable()
export class AiDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AiDigest');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: BotReportService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    const enabled = process.env.AI_DIGEST_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') return;
    // Every 20 minutes: three chances inside the Monday-9-o'clock hour of every time zone.
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`digest sweep failed: ${String((e as Error)?.message ?? e).slice(0, 140)}`)), 20 * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  async get(user: AuthenticatedUser): Promise<{ on: boolean }> {
    const tenantId = this.tenantOf(user);
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: DIGEST_KEY } } }).catch(() => null);
    return { on: digestSettingFrom(row?.value).on };
  }

  async set(user: AuthenticatedUser, on: boolean): Promise<{ on: boolean }> {
    const tenantId = this.tenantOf(user);
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: DIGEST_KEY } } }).catch(() => null);
    const value = JSON.stringify({ on: on === true, lastWeek: digestSettingFrom(row?.value).lastWeek });
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: DIGEST_KEY } }, create: { tenantId, key: DIGEST_KEY, value }, update: { value } });
    await this.prisma.auditLog.create({ data: { tenantId, userId: user.userId ?? null, action: on === true ? 'messenger.ai_digest_on' : 'messenger.ai_digest_off', resourceType: 'setting', resourceId: DIGEST_KEY } }).catch(() => undefined);
    return { on: on === true };
  }

  /** The salons that switched it on and whose Monday nine o'clock is now. */
  async sweep(now = new Date()): Promise<{ sent: number; salons: number }> {
    const rows = await this.prisma.setting.findMany({ where: { key: DIGEST_KEY }, select: { tenantId: true, value: true }, take: 5000 });
    let sent = 0; let salons = 0;
    for (const row of rows) {
      const setting = digestSettingFrom(row.value);
      if (!setting.on) continue;
      const tenant = await this.prisma.tenant.findFirst({ where: { id: row.tenantId, deletedAt: null }, select: { id: true, timezone: true, market: true } as never }).catch(() => null) as { id: string; timezone: string | null; market?: string | null } | null;
      if (!tenant) continue;
      const week = digestDue(setting, now, tenant.timezone || 'America/New_York');
      if (!week) continue;
      // Claimed BEFORE sending: a second instance or a restart reads the week as done.
      const value = JSON.stringify({ on: true, lastWeek: week });
      await this.prisma.setting.update({ where: { tenantId_key: { tenantId: tenant.id, key: DIGEST_KEY } }, data: { value } });
      try {
        const r = await this.reports.forTenant(tenant.id, 7);
        const payload = digestPush({ conversations: r.conversations, selfHandledRate: r.selfHandledRate, booked: r.booked, toTeach: r.unanswered.open, happyRate: r.survey.happyRate }, String(tenant.market ?? '').toUpperCase() === 'VN');
        if (!payload) continue;
        const owners = await this.prisma.user.findMany({ where: { tenantId: tenant.id, role: UserRole.SALON_ADMIN, isActive: true }, select: { id: true }, take: 20 });
        let n = 0;
        for (const o of owners) n += await this.push.sendToUser(tenant.id, o.id, payload).catch(() => 0);
        if (n) { sent += n; salons++; }
      } catch (e) {
        this.logger.warn(`digest for ${tenant.id} failed: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
      }
    }
    if (sent) this.logger.log(`AI digest: ${sent} push(es) to the owners of ${salons} salon(s).`);
    return { sent, salons };
  }
}
