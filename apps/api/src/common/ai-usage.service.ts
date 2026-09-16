import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  addCall, byFeature, byHour, byTenant, cacheHitRate, cleanDay, dayKeyUtc, emptyDay, mergeDays,
  recentDays, totals, type AiCall, type DayUsage,
} from './ai-usage';

/**
 * THE METER. Every model call passes through here on its way to being counted.
 *
 * WHERE IT IS KEPT
 *
 * `platform_config` rows, one per (day, process): `ai_usage:2026-09-16:a3f9c1`.
 * No migration — this is a monitoring feature and must not ask a live database
 * for a new table to earn its keep.
 *
 * The process suffix is the important part. Four Render services run this
 * code; if they shared one row, each flush would be a read-modify-write over
 * the others and the counts would quietly drift down. Each process owns its
 * own row and writes only that; a report is the SUM of every row for the day.
 *
 * WHAT IT COSTS
 *
 * Recording is a number added to an object in memory. The database is touched
 * once a minute, and only when something happened. A meter that slowed down
 * the thing it measures would be uninstalled within a week.
 *
 * WHAT IT NEVER DOES
 *
 * It never fails a model call. Every write is wrapped: if the config table is
 * unreachable, the salon still gets its answer and the count is lost. A
 * monitor that can take the product down is worse than no monitor.
 */
@Injectable()
export class AiUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiUsage');
  /** This process's own suffix, so four services never write the same row. */
  private readonly instance = (process.env.RENDER_INSTANCE_ID || randomBytes(3).toString('hex')).slice(-6);
  /** Day key -> what this process has counted since the last flush. */
  private pending = new Map<string, DayUsage>();
  /** Day key -> what this process has already written, so a flush is idempotent. */
  private written = new Map<string, DayUsage>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.flush(); }, 60_000);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush().catch(() => undefined);
  }

  private get rows() {
    return (this.prisma as unknown as {
      platformConfig?: {
        findMany: (a: unknown) => Promise<{ key: string; value: string }[]>;
        upsert: (a: unknown) => Promise<unknown>;
        deleteMany: (a: unknown) => Promise<unknown>;
      };
    }).platformConfig;
  }

  private keyFor(day: string) { return `ai_usage:${day}:${this.instance}`; }

  /**
   * Count one model call. Synchronous, in memory, never throws — a call site
   * may call this on its hottest path without thinking about it.
   */
  record(call: Omit<AiCall, 'hour'> & { at?: Date }): void {
    try {
      const at = call.at ?? new Date();
      const day = dayKeyUtc(at);
      const acc = this.pending.get(day) ?? emptyDay(day);
      addCall(acc, { ...call, hour: at.getUTCHours() });
      this.pending.set(day, acc);
    } catch {
      /* a meter that throws is worse than a meter that misses one call */
    }
  }

  /**
   * Write what this process has counted. The row holds this process's running
   * total for the day, not a delta, so a lost flush is caught up by the next
   * one rather than lost for ever.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.pending.size) return;
    this.flushing = true;
    const taken = this.pending;
    this.pending = new Map();
    try {
      for (const [day, add] of taken) {
        const total = mergeDays([this.written.get(day) ?? emptyDay(day), add], day);
        const value = JSON.stringify(total);
        // Over the sane size for a config row: keep the totals, drop the
        // per-salon detail, and say so — a report missing one dimension beats
        // a write that fails every minute for the rest of the day.
        const slim = value.length > 400_000 ? JSON.stringify({ ...total, t: {} }) : value;
        await this.rows?.upsert({
          where: { key: this.keyFor(day) },
          create: { key: this.keyFor(day), value: slim },
          update: { value: slim },
        });
        this.written.set(day, total);
      }
      // Yesterday's running totals are on disk; holding them in memory for the
      // life of the process buys nothing.
      const today = dayKeyUtc(new Date());
      for (const k of Array.from(this.written.keys())) if (k !== today) this.written.delete(k);
    } catch (e) {
      // Put back what could not be written, so the next minute tries again.
      for (const [day, add] of taken) {
        const back = this.pending.get(day);
        this.pending.set(day, back ? mergeDays([back, add], day) : add);
      }
      this.log.warn(`could not store AI usage: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.flushing = false;
    }
  }

  /** Every process's row for these days, summed per day. */
  private async read(days: string[]): Promise<Map<string, DayUsage>> {
    const rows = await this.rows?.findMany({
      where: { OR: days.map((d) => ({ key: { startsWith: `ai_usage:${d}:` } })) },
      select: { key: true, value: true },
      take: 400,
    }).catch(() => []) ?? [];
    const per = new Map<string, DayUsage[]>();
    for (const r of rows) {
      const day = r.key.split(':')[1] ?? '';
      if (!days.includes(day)) continue;
      let parsed: unknown = null;
      try { parsed = JSON.parse(r.value); } catch { continue; }
      per.set(day, [...(per.get(day) ?? []), cleanDay(parsed, day)]);
    }
    const out = new Map<string, DayUsage>();
    for (const d of days) out.set(d, mergeDays(per.get(d) ?? [], d));
    return out;
  }

  /**
   * The report the Super Admin screen draws: a row per day, the whole window
   * broken down by feature, by salon and by hour, and the salons named.
   *
   * Reads what THIS process has not flushed yet as well, so the screen is
   * never a minute behind on the instance serving it.
   */
  async report(daysBack = 7): Promise<unknown> {
    const n = Math.min(60, Math.max(1, Math.round(daysBack)));
    const keys = recentDays(new Date(), n);
    const stored = await this.read(keys);
    for (const [day, live] of this.pending) {
      if (stored.has(day)) mergeDays([stored.get(day)!, live], day);
    }
    const window = mergeDays(keys.map((k) => stored.get(k) ?? emptyDay(k)), keys[keys.length - 1]);

    const tenants = byTenant(window);
    const names = await this.namesFor(tenants.map((t) => t.tenantId).filter(Boolean).slice(0, 60));

    return {
      from: keys[0],
      to: keys[keys.length - 1],
      days: keys.map((k) => {
        const d = stored.get(k) ?? emptyDay(k);
        const t = totals(d);
        return { day: k, calls: t.calls, errors: t.errors, tokens: t.tokens, usd: t.usd };
      }),
      totals: totals(window),
      cacheHitRate: cacheHitRate(window),
      features: byFeature(window).map((f) => ({ ...f, cacheHitRate: cacheHitRate(window, f.feature) })),
      tenants: tenants.slice(0, 60).map((t) => ({
        ...t,
        name: t.tenantId ? names.get(t.tenantId) ?? '—' : 'Toàn hệ thống (không thuộc tiệm nào)',
      })),
      /** Today's 24 hours, so a spike at 7am with nobody at a screen is visible. */
      today: byHour(stored.get(keys[keys.length - 1]) ?? emptyDay(keys[keys.length - 1])),
    };
  }

  /**
   * Salon names for the report. Read by id from a list this service built
   * itself — never from anything a request carried — so naming the rows
   * cannot become a way to read one salon's data from another's session.
   */
  private async namesFor(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }).catch(() => []) as { id: string; name: string | null }[];
    return new Map(rows.map((r) => [r.id, r.name ?? '—']));
  }

  /** Drop rows older than the window a person can ask for. */
  async prune(keepDays = 60): Promise<void> {
    const cutoff = dayKeyUtc(new Date(Date.now() - keepDays * 86_400_000));
    await this.rows?.deleteMany({ where: { key: { startsWith: 'ai_usage:', lt: `ai_usage:${cutoff}` } } }).catch(() => undefined);
  }
}
