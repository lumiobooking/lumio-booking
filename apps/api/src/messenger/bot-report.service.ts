import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { botReport, type BotReport, type ReportThread } from './bot-report';
import type { StoredTurn } from './followup';
import { leakedTurns, type LeakedTurn } from './correction-guard';

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

  /**
   * PLATFORM check (support / super admin only — see SupportAiLeaksController):
   * across every salon, the AI replies of the last `days` that talked about a
   * correction note instead of to the customer (./correction-guard). Read
   * only; each hit names its salon so support can open that conversation.
   */
  async leakScan(days?: number): Promise<{ days: number; threads: number; hits: (LeakedTurn & { tenantId: string; tenantName: string; threadId: string; channel: string })[]; truncated: boolean }> {
    const d = Math.min(90, Math.max(1, Math.round(Number(days) || 30)));
    const from = new Date(Date.now() - d * 86_400_000);
    const hits: (LeakedTurn & { tenantId: string; tenantName: string; threadId: string; channel: string })[] = [];
    let cursor: string | undefined; let threads = 0; let truncated = false;
    for (let page = 0; page < 60; page++) {
      const rows = await this.prisma.messengerThread.findMany({
        where: { lastMessageAt: { gte: from } },
        select: { id: true, tenantId: true, channel: true, history: true },
        orderBy: { id: 'asc' }, take: 400, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      threads += rows.length;
      for (const r of rows) for (const h of leakedTurns(r.history, from.getTime())) hits.push({ ...h, tenantId: r.tenantId, tenantName: '', threadId: r.id, channel: r.channel });
      cursor = rows[rows.length - 1].id;
      if (rows.length < 400) break;
      if (page === 59) truncated = true;
    }
    const names = new Map((await this.prisma.tenant.findMany({ where: { id: { in: Array.from(new Set(hits.map((h) => h.tenantId))) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    for (const h of hits) h.tenantName = names.get(h.tenantId) ?? '';
    hits.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    return { days: d, threads, hits: hits.slice(0, 200), truncated: truncated || hits.length > 200 };
  }
}
