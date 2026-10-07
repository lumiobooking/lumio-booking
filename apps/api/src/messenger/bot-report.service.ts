import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { botReport, type BotReport, type ReportThread } from './bot-report';
import type { StoredTurn } from './followup';

/** Reads ONE salon's conversations, bookings and open questions for the bot report. */
@Injectable()
export class BotReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(user: AuthenticatedUser, days?: number): Promise<BotReport & { days: number }> {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new NotFoundException('No tenant context');
    return this.forTenant(tenantId, days);
  }

  async forTenant(tenantId: string, days?: number): Promise<BotReport & { days: number }> {
    const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    const to = new Date();
    const from = new Date(to.getTime() - d * 86_400_000);
    const gaps = (this.prisma as unknown as { botKnowledgeGap?: { count: (a: unknown) => Promise<number> } }).botKnowledgeGap;
    const [threads, bookings, gapsOpen, gapsNew] = await Promise.all([
      this.prisma.messengerThread.findMany({
        where: { tenantId, OR: [{ lastCustomerAt: { gte: from } }, { lastMessageAt: { gte: from } }] },
        select: { id: true, channel: true, handoff: true, customerId: true, lastMessageAt: true, history: true },
        take: 2000,
      }),
      this.prisma.appointment.findMany({
        where: { tenantId, createdAt: { gte: new Date(from.getTime() - 86_400_000) } },
        select: { customerId: true, createdAt: true },
        take: 10_000,
      }),
      gaps ? gaps.count({ where: { tenantId, status: 'open' } }).catch(() => 0) : Promise.resolve(0),
      gaps ? gaps.count({ where: { tenantId, firstAt: { gte: from } } }).catch(() => 0) : Promise.resolve(0),
    ]);
    const rows: ReportThread[] = threads.map((t) => ({
      id: t.id, channel: t.channel, handoff: t.handoff, customerId: t.customerId, lastMessageAt: t.lastMessageAt,
      history: (Array.isArray(t.history) ? t.history : []) as unknown as StoredTurn[],
    }));
    return { ...botReport({ threads: rows, bookings, gapsOpen, gapsNew, from, to }), days: d };
  }
}
