import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { CustomersService } from './customers.service';
import { followUpPush } from './follow-ups';

const SENT_KEY = 'lead_followup_push';

/**
 * ONE MORNING PUSH per real-estate office: "📞 3 leads to call today". Runs
 * every 30 minutes; for each office whose industry is REAL_ESTATE, once its
 * own clock passes 8:00 and it has not been told today. Every read carries
 * the office's tenantId; the push goes to that office's own devices only.
 * HOUSEKEEPING_ENABLED=false turns it off.
 */
@Injectable()
export class LeadFollowUpScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LeadFollowUps');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    @Optional() private readonly push?: PushService,
  ) {}

  onModuleInit() {
    const enabled = process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') return;
    this.timer = setInterval(() => void this.tick(), 30 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()): Promise<number> {
    if (!this.push) return 0;
    const rows = await this.prisma.setting.findMany({ where: { key: 'industry' }, select: { tenantId: true, value: true } }).catch(() => []);
    let sent = 0;
    for (const r of rows) {
      if (String((r.value as { key?: string } | null)?.key ?? '').toUpperCase() !== 'REAL_ESTATE') continue;
      try {
        const t = await this.prisma.tenant.findUnique({ where: { id: r.tenantId }, select: { timezone: true, businessType: true, market: true } });
        if (!t || String(t.businessType) !== 'REAL_ESTATE') continue;
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: t.timezone || 'UTC', hour: 'numeric', hour12: false }).format(now)) % 24;
        if (hour < 8) continue;
        const { today, items } = await this.customers.followUpsForTenant(r.tenantId, now);
        const last = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId: r.tenantId, key: SENT_KEY } } });
        if ((last?.value as { day?: string } | null)?.day === today) continue;
        await this.prisma.setting.upsert({
          where: { tenantId_key: { tenantId: r.tenantId, key: SENT_KEY } },
          update: { value: { day: today } }, create: { tenantId: r.tenantId, key: SENT_KEY, value: { day: today } },
        });
        const msg = followUpPush(items, String(t.market ?? '').toUpperCase() === 'VN');
        if (!msg) continue;
        await this.push.sendToTenant(r.tenantId, { ...msg, url: '/salon/customers?followups=1', tag: `lead-followups-${today}` });
        sent++;
      } catch (e) {
        this.logger.warn(`Follow-up push failed for ${r.tenantId}: ${String(e).slice(0, 120)}`);
      }
    }
    return sent;
  }
}
