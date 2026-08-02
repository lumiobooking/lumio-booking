import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WalkInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Housekeeping for the operational logs that grow without bound.
 *
 * What this deliberately NEVER touches: appointments, walk-ins that produced a
 * ticket, orders, order items, payments, customers, loyalty. That is the
 * salon's money and history — it backs their revenue reports, their tax
 * position and each customer's spend, so it is kept for the life of the
 * account. Only records whose usefulness genuinely expires are pruned.
 *
 * Runs once a day, in small batches, and is safe to run twice.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Retention');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 24 * 60 * 60 * 1000;

  // Windows are generous on purpose: the cost of keeping a log one extra month
  // is a few megabytes; the cost of deleting one someone still needed is a
  // dispute you cannot answer.
  static readonly AUDIT_DAYS = 180;        // who changed what — useful while a dispute is fresh
  static readonly NOTIFICATION_DAYS = 90;  // proof a reminder was sent
  static readonly DEAD_WALKIN_DAYS = 30;   // cancelled tickets that never took money
  private readonly BATCH = 5000;           // keep each delete short so nothing locks up

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // OFF until explicitly switched on. Deleting rows is the one thing that
    // cannot be undone by redeploying, so it never starts by itself.
    const enabled = process.env.RETENTION_ENABLED ?? 'false';
    if (enabled !== 'true') {
      this.logger.log('Retention sweep disabled (set RETENTION_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 5 * 60 * 1000); // well after boot, never during a deploy spike
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log('Retention sweep on (daily).');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private daysAgo(n: number): Date {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  }

  private async tick() {
    try {
      const r = await this.sweep();
      const total = r.auditLogs + r.notifications + r.deadWalkIns;
      if (total > 0) {
        this.logger.log(`Pruned ${total} row(s): audit ${r.auditLogs}, notifications ${r.notifications}, dead walk-ins ${r.deadWalkIns}.`);
      }
    } catch (e) {
      this.logger.warn(`Retention sweep failed: ${(e as Error).message}`);
    }
  }

  /**
   * One pass. Returns what was removed so a Super Admin can run it by hand and
   * see the effect. Platform-wide: retention is a housekeeping policy, not a
   * per-salon setting.
   */
  async sweep(): Promise<{ auditLogs: number; notifications: number; deadWalkIns: number }> {
    const auditLogs = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: this.daysAgo(RetentionService.AUDIT_DAYS) } },
    });

    const notifications = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: this.daysAgo(RetentionService.NOTIFICATION_DAYS) } },
    });

    // Only tickets that were cancelled AND never became money: no order, no
    // linked appointment, and nothing on the ticket. A cancelled walk-in that
    // was still rung up stays, because its order references it.
    const cutoff = this.daysAgo(RetentionService.DEAD_WALKIN_DAYS);
    const candidates = await this.prisma.walkIn.findMany({
      where: { status: WalkInStatus.CANCELLED, createdAt: { lt: cutoff }, appointmentId: null },
      select: { id: true },
      take: this.BATCH,
    });
    let deadWalkIns = 0;
    if (candidates.length) {
      // Order.walkInId is a plain column (no Prisma relation), so the "did this
      // ticket ever take money?" check is an explicit second query.
      const ids = candidates.map((w) => w.id);
      const billed = await this.prisma.order.findMany({
        where: { walkInId: { in: ids } },
        select: { walkInId: true },
        distinct: ['walkInId'],
      });
      const keep = new Set(billed.map((o) => o.walkInId).filter((x): x is string => !!x));
      const removable = ids.filter((id) => !keep.has(id));
      if (removable.length) {
        deadWalkIns = (await this.prisma.walkIn.deleteMany({ where: { id: { in: removable } } })).count;
      }
    }

    return { auditLogs: auditLogs.count, notifications: notifications.count, deadWalkIns };
  }
}
