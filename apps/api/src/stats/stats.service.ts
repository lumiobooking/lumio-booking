import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, OrderStatus, WalkInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CANONICAL_SOURCES, CanonicalSource, normalizeSource } from '../common/source.util';

type Bucket = 'day' | 'month' | 'year';
type SourceCounts = Record<CanonicalSource, number>;
const zero = (): SourceCounts => ({ online: 0, hotline: 0, messenger: 0, walkin: 0, staff: 0 });

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private parts(d: Date, tz: string) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const p: Record<string, string> = {};
    for (const x of f.formatToParts(d)) p[x.type] = x.value;
    return { y: p.year, m: p.month, d: p.day };
  }
  private keyFor(d: Date, bucket: Bucket, tz: string): string {
    const { y, m, d: day } = this.parts(d, tz);
    if (bucket === 'year') return y;
    if (bucket === 'month') return `${y}-${m}`;
    return `${y}-${m}-${day}`;
  }

  /** Visits (appointments by channel + walk-ins) and POS revenue by channel,
   *  bucketed by day/month/year in the salon's timezone. */
  async sources(user: AuthenticatedUser, bucketRaw?: string, fromRaw?: string, toRaw?: string) {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = tenant?.timezone || 'America/New_York';
    const bucket: Bucket = bucketRaw === 'year' ? 'year' : bucketRaw === 'month' ? 'month' : 'day';

    // Range: explicit from/to, else a sensible default per bucket.
    const now = new Date();
    let from: Date;
    let to: Date = toRaw ? new Date(`${toRaw}T23:59:59`) : now;
    if (fromRaw) {
      from = new Date(`${fromRaw}T00:00:00`);
    } else if (bucket === 'year') {
      from = new Date(Date.UTC(now.getUTCFullYear() - 4, 0, 1));
    } else if (bucket === 'month') {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    } else {
      from = new Date(now.getTime() - 13 * 86400000);
    }
    if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 13 * 86400000);
    if (Number.isNaN(to.getTime())) to = now;

    // Ordered list of bucket keys spanning the range (so empty periods show as 0).
    const keys: string[] = [];
    const seen = new Set<string>();
    const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
    while (cur.getTime() <= to.getTime() + 86400000) {
      const k = this.keyFor(cur, bucket, tz);
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
      if (bucket === 'year') cur.setUTCFullYear(cur.getUTCFullYear() + 1);
      else if (bucket === 'month') cur.setUTCMonth(cur.getUTCMonth() + 1);
      else cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const [appts, walkins, orders] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lte: to }, status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] } },
        select: { startTime: true, source: true },
      }),
      this.prisma.walkIn.findMany({
        where: { tenantId, createdAt: { gte: from, lte: to }, status: { not: WalkInStatus.CANCELLED }, appointmentId: null },
        select: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId, status: OrderStatus.PAID, createdAt: { gte: from, lte: to } },
        select: { createdAt: true, paidAt: true, source: true, totalCents: true },
      }),
    ]);

    const visits = new Map<string, SourceCounts>(keys.map((k) => [k, zero()]));
    const revenue = new Map<string, SourceCounts>(keys.map((k) => [k, zero()]));
    for (const a of appts) {
      const k = this.keyFor(a.startTime, bucket, tz);
      const b = visits.get(k); if (b) b[normalizeSource(a.source)]++;
    }
    for (const w of walkins) {
      const k = this.keyFor(w.createdAt, bucket, tz);
      const b = visits.get(k); if (b) b.walkin++;
    }
    for (const o of orders) {
      const k = this.keyFor(o.paidAt ?? o.createdAt, bucket, tz);
      const b = revenue.get(k); if (b) b[o.source ? normalizeSource(o.source) : 'walkin'] += o.totalCents;
    }

    const totalsVisits = zero();
    const totalsRevenue = zero();
    const buckets = keys.map((k) => {
      const v = visits.get(k) ?? zero();
      const r = revenue.get(k) ?? zero();
      let vt = 0; let rt = 0;
      for (const s of CANONICAL_SOURCES) { vt += v[s]; rt += r[s]; totalsVisits[s] += v[s]; totalsRevenue[s] += r[s]; }
      return { key: k, visits: v, visitsTotal: vt, revenueCents: r, revenueTotalCents: rt };
    });
    let visitsGrand = 0; let revenueGrand = 0;
    for (const s of CANONICAL_SOURCES) { visitsGrand += totalsVisits[s]; revenueGrand += totalsRevenue[s]; }

    return {
      bucket, tz,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      sources: CANONICAL_SOURCES,
      buckets,
      totals: { visits: totalsVisits, visitsTotal: visitsGrand, revenueCents: totalsRevenue, revenueTotalCents: revenueGrand },
    };
  }
}
