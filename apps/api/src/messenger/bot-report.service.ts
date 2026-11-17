import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { botReport, type BotReport, type ReportThread } from './bot-report';
import type { StoredTurn } from './followup';
import { leakedTurns, type LeakedTurn } from './correction-guard';
import { fleetReport, type FleetReport, type FleetThread } from './ai-fleet';

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
  /**
   * PLATFORM report (support / super admin only — see SupportAiFleetController):
   * one row of NUMBERS per salon — how fast its AI answers, how often it
   * failed, who is still waiting (./ai-fleet). Read only. Each salon's row is
   * computed from that salon's own conversations; no message text leaves here.
   */
  async fleet(days?: number): Promise<FleetReport & { truncated: boolean }> {
    const d = [1, 7, 30].includes(Number(days)) ? Number(days) : 7;
    const to = new Date();
    const from = new Date(to.getTime() - d * 86_400_000);
    const ins = (this.prisma as unknown as { aiInstruction?: { groupBy: (a: unknown) => Promise<{ tenantId: string; _sum: { usedCount: number | null; blockedCount: number | null } }[]> } }).aiInstruction;
    const [tenants, conns, bookings, sums] = await Promise.all([
      this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true }, take: 5000 }),
      this.prisma.messengerConnection.findMany({ select: { tenantId: true, enabled: true }, take: 5000 }),
      this.prisma.appointment.findMany({ where: { createdAt: { gte: new Date(from.getTime() - 86_400_000) } }, select: { tenantId: true, customerId: true, createdAt: true }, take: 50_000 }),
      ins ? ins.groupBy({ by: ['tenantId'], _sum: { usedCount: true, blockedCount: true } }).catch(() => []) : Promise.resolve([]),
    ]);
    const threads: FleetThread[] = [];
    let cursor: string | undefined; let truncated = false;
    for (let page = 0; page < 60; page++) {
      const rows = await this.prisma.messengerThread.findMany({
        where: { OR: [{ lastCustomerAt: { gte: from } }, { lastMessageAt: { gte: from } }] },
        select: { id: true, tenantId: true, channel: true, handoff: true, customerId: true, lastMessageAt: true, history: true },
        orderBy: { id: 'asc' }, take: 400, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const t of rows) {
        threads.push({
          id: t.id, tenantId: t.tenantId, channel: t.channel, handoff: t.handoff, customerId: t.customerId, lastMessageAt: t.lastMessageAt,
          history: (Array.isArray(t.history) ? t.history : []) as unknown as StoredTurn[],
        });
      }
      if (rows.length < 400) break;
      cursor = rows[rows.length - 1].id;
      if (page === 59) truncated = true;
    }
    const enabledOf = new Map(conns.map((c) => [c.tenantId, c.enabled]));
    const active = new Set(threads.map((t) => t.tenantId));
    // A salon is listed when it has a chat channel or a conversation in the period; the rest are only counted.
    const listed = tenants.filter((t) => enabledOf.has(t.id) || active.has(t.id));
    const report = fleetReport({
      salons: listed.map((t) => ({ id: t.id, name: t.name, slug: t.slug, botOn: enabledOf.has(t.id) ? Boolean(enabledOf.get(t.id)) : null })),
      threads,
      bookings: bookings.filter((b): b is typeof b & { customerId: string } => Boolean(b.customerId)).map((b) => ({ tenantId: b.tenantId, customerId: b.customerId, createdAt: b.createdAt })),
      instructions: sums.map((r) => ({ tenantId: r.tenantId, used: r._sum.usedCount ?? 0, blocked: r._sum.blockedCount ?? 0 })),
      from, to, days: d,
    });
    report.totals.noChannel += tenants.length - listed.length;
    report.totals.salons = tenants.length;
    return { ...report, truncated };
  }
}
