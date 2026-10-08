/**
 * THE AGENCY'S BOARD: every salon's month on one screen — where its report
 * stands, whether its channels are being read, whether it went out. The
 * agency used to open thirty salons to learn this.
 *
 * Reads only; each salon's figures come from the same tenant-scoped calls the
 * salon's own screen uses (lifecycle, health, posts), run as the system user
 * pinned to that one tenant.
 */
import { Injectable } from '@nestjs/common';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { MarketingService } from './marketing.service';
import { SyncQueueService } from './sync-queue.service';
import { lifecycleOf, nextActionOf, autoSendDue, type LifecycleState } from './report-lifecycle';
import type { HealthLevel } from './sync-plan';
import { dayKeyTz } from '../common/salon-time';

export interface BoardRow {
  tenantId: string;
  name: string;
  slug: string;
  market: string | null;
  state: LifecycleState;
  nextAction: ReturnType<typeof nextActionOf>;
  autoSend: boolean;
  autoSendDue: boolean;
  report: { status: string; approvedAt: Date | null; sentAt: Date | null; updatedAt: Date } | null;
  /** Worst connected-channel level, and how many channels sit at each. */
  health: { worst: HealthLevel; counts: Record<HealthLevel, number>; bad: string[] };
  posts: number;
  measuredAt: string | null;
  queued: number;
  guardStray: number;
}

const SYSTEM: AuthenticatedUser = { userId: 'system', email: 'system@lumio.local', role: UserRole.SUPER_ADMIN, tenantId: null };
const RANK: Record<HealthLevel, number> = { bad: 3, warn: 2, ok: 1, off: 0 };

/** The board's sort: the salon that needs a person first comes first. */
export function boardOrder(a: BoardRow, b: BoardRow): number {
  const urgency = (r: BoardRow) =>
    (r.health.worst === 'bad' ? 40 : 0)
    + (r.guardStray ? 20 : 0)
    + (r.nextAction === 'review' || r.nextAction === 'send' ? 15 : r.nextAction === 'generate' ? 10 : 0)
    + (r.state === 'sent' ? -30 : 0);
  return urgency(b) - urgency(a) || a.name.localeCompare(b.name);
}

@Injectable()
export class ReportsBoardService {
  constructor(private readonly prisma: PrismaService, private readonly marketing: MarketingService, private readonly queue: SyncQueueService) {}

  async board(month: string): Promise<{ month: string; rows: BoardRow[]; totals: Record<LifecycleState, number> }> {
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must be YYYY-MM');
    const tenants = await this.prisma.tenant.findMany({
      where: { status: TenantStatus.ACTIVE, deletedAt: null },
      select: { id: true, name: true, slug: true, market: true, timezone: true },
      orderBy: { name: 'asc' },
    });
    const reports = await this.prisma.marketingReport.findMany({
      where: { periodMonth: month, tenantId: { in: tenants.map((t) => t.id) } },
      select: { tenantId: true, status: true, approvedAt: true, sentAt: true, updatedAt: true, content: true },
    });
    const byTenant = new Map(reports.map((r) => [r.tenantId, r]));
    const rows: BoardRow[] = [];
    // A few salons at a time: each health read is several queries.
    for (let i = 0; i < tenants.length; i += 5) {
      const batch = tenants.slice(i, i + 5);
      const done = await Promise.all(batch.map(async (t): Promise<BoardRow> => {
        const r = byTenant.get(t.id) ?? null;
        const policy = await this.marketing.getReportPolicy(t.id);
        const todayKey = dayKeyTz(new Date(), t.timezone || 'UTC');
        const state = lifecycleOf(month, r, todayKey);
        const h = await this.queue.health(SYSTEM, month, t.id).catch(() => null);
        const counts: Record<HealthLevel, number> = { ok: 0, warn: 0, bad: 0, off: 0 };
        const bad: string[] = [];
        let worst: HealthLevel = 'off';
        for (const c of h?.channels ?? []) {
          counts[c.level]++;
          if (RANK[c.level] > RANK[worst]) worst = c.level;
          if (c.level === 'bad') bad.push(`${c.platform}: ${c.key}${c.detail ? ` (${c.detail})` : ''}`);
        }
        const guard = (r?.content as { _guard?: { stray?: unknown[] } } | null)?._guard;
        return {
          tenantId: t.id, name: t.name, slug: t.slug, market: t.market ?? null,
          state, nextAction: nextActionOf(state, policy), autoSend: policy.autoSend,
          autoSendDue: autoSendDue(month, r, policy, todayKey),
          report: r ? { status: r.status, approvedAt: r.approvedAt, sentAt: r.sentAt, updatedAt: r.updatedAt } : null,
          health: { worst, counts, bad },
          posts: h?.posts.total ?? 0, measuredAt: h?.posts.measuredAt ?? null, queued: h?.queued ?? 0,
          guardStray: Array.isArray(guard?.stray) ? guard!.stray!.length : 0,
        };
      }));
      rows.push(...done);
    }
    rows.sort(boardOrder);
    const totals: Record<LifecycleState, number> = { collecting: 0, closing: 0, none: 0, draft: 0, approved: 0, sent: 0 };
    for (const r of rows) totals[r.state]++;
    return { month, rows, totals };
  }
}
