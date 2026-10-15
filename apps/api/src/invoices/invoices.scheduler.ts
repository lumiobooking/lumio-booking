import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

/**
 * Daily sweep that issues invoices automatically:
 *  - OVERAGE: in the first days of a month, bills the PREVIOUS month's usage
 *    overage (SMS + AI Hotline minutes) for every tenant that went over plan.
 *  - RENEWAL: when a tenant WITHOUT an active gateway subscription has access
 *    expiring within 3 days, bills the plan renewal.
 * Both are idempotent (one invoice per tenant/type/period) and only email once,
 * so running daily is safe. Disable with INVOICES_ENABLED=false.
 */
@Injectable()
export class InvoicesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Invoices');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 24 * 60 * 60 * 1000; // daily

  constructor(private readonly prisma: PrismaService, private readonly invoices: InvoicesService) {}

  onModuleInit() {
    const enabled = process.env.INVOICES_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Invoice dispatcher disabled (set INVOICES_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.runOnce().catch(() => {}), 90 * 1000); // shortly after boot
    this.timer = setInterval(() => this.runOnce().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    this.logger.log('Invoice dispatcher on (daily).');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep. Returns counts of newly-emailed invoices. Safe to call repeatedly. */
  async runOnce(): Promise<{ overage: number; renewal: number }> {
    const now = new Date();
    const day = now.getUTCDate(); // same UTC convention as the billing months
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null, planId: { not: null } },
      select: { id: true, accessUntil: true },
    });
    let overage = 0;
    let renewal = 0;
    for (const t of tenants) {
      try {
        // --- OVERAGE for last month (only run in the first days of the month) ---
        if (day <= 3) {
          const inv = await this.invoices.buildOverageInvoice(t.id, prevMonth);
          // Charged from the salon's PayPal subscription BEFORE the email, so
          // the owner reads "paid" rather than "please pay" where it worked.
          if (inv) await this.invoices.autoCharge(inv.id);
          if (inv && (await this.invoices.sendInvoiceEmail(inv.id))) overage++;
        }
        // --- RENEWAL when access is expiring and there is no active subscription ---
        if (t.accessUntil) {
          const soon = new Date(now); soon.setDate(soon.getDate() + 3);
          if (t.accessUntil <= soon) {
            const hasSub = await this.prisma.subscription.findFirst({
              where: { tenantId: t.id, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] } },
              select: { id: true },
            });
            if (!hasSub) {
              // A plan change asked for mid-month lands here, before the price is read.
              await this.invoices.applyPendingPlanChange(t.id).catch(() => undefined);
              const period = new Date(t.accessUntil.getFullYear(), t.accessUntil.getMonth(), 1);
              const inv = await this.invoices.buildRenewalInvoice(t.id, period);
              // Charged to the card saved in Lumio when there is one (a no-op
              // otherwise); the email then reads "paid" rather than "please pay".
              if (inv) await this.invoices.autoCharge(inv.id);
              if (inv && (await this.invoices.sendInvoiceEmail(inv.id))) renewal++;
            }
          }
        }
      } catch (e) {
        this.logger.warn(`Invoice sweep failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    if (overage || renewal) this.logger.log(`Issued ${overage} overage + ${renewal} renewal invoice(s).`);
    return { overage, renewal };
  }
}
