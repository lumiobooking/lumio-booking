import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { SyncQueueService } from './sync-queue.service';
import { onChannelSyncRequest } from './sync-signals';

/**
 * Marketing background work, in three beats:
 *
 *  1. WORKER (every 5 min): run the sync jobs that are due (sync-queue.service).
 *     The queue lives in the database, so a deploy or a Render restart loses
 *     nothing — a job claimed by a process that died is re-queued on the next
 *     tick (sync-plan.ts, isStaleRunning).
 *  2. PLANNER (once a day): queue every active salon's months that are still
 *     moving (this month; last month while its posts' numbers settle). This is
 *     what makes the report screen's sync button optional.
 *  3. MONTH CLOSE (first 5 days of a month, once per month per process): draft
 *     LAST month's report for every salon with activity — left in 'review' so a
 *     human approves before a client sees it. Salons whose policy says so
 *     (report-lifecycle.ts) get it sent by itself on their send day, from the
 *     daily beat.
 *
 * A Page webhook ("the salon just posted", sync-signals.ts) queues that
 * salon's month outside the daily beat.
 *
 * OFF unless MARKETING_AUTOREPORT_ENABLED=true (defaults on in production, like
 * the campaigns dispatcher). Same Render warm-window caveat as other schedulers.
 */
@Injectable()
export class MarketingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MarketingAutoReport');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 5 * 60 * 1000; // worker beat
  private lastMonthRun: string | null = null;
  private lastDailyPlan: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private busy = false;

  constructor(private readonly marketing: MarketingService, private readonly queue: SyncQueueService) {}

  onModuleInit() {
    const enabled = process.env.MARKETING_AUTOREPORT_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Auto-report disabled (set MARKETING_AUTOREPORT_ENABLED=true to enable).');
      return;
    }
    this.unsubscribe = onChannelSyncRequest((pageId) => {
      this.queue.enqueueForPage(pageId).then((created) => { if (created) this.logger.log(`Page ${pageId} posted — month sync queued.`); }).catch(() => undefined);
    });
    setTimeout(() => this.tick(), 90 * 1000); // shortly after boot
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Marketing worker on (every ${this.intervalMs / 60000} min).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
  }

  private async dailyPlan() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.lastDailyPlan === day) return;
    this.lastDailyPlan = day;
    try {
      const r = await this.queue.enqueueDaily();
      const gone = await this.queue.cleanup().catch(() => 0);
      this.logger.log(`Daily plan: ${r.jobs} job(s) for ${r.tenants} salon(s), months ${r.months.join(', ')}${gone ? `, ${gone} old row(s) cleared` : ''}.`);
      // Salons whose policy sends last month's report by itself, on their send day.
      const a = await this.marketing.runAutoSend().catch((e) => { this.logger.warn(`Auto-send failed: ${(e as Error).message}`); return null; });
      if (a && (a.sent || a.failed)) this.logger.log(`Auto-send: ${a.sent} sent, ${a.failed} failed.`);
    } catch (e) {
      this.lastDailyPlan = null; // try again next tick
      this.logger.warn(`Daily plan failed: ${(e as Error).message}`);
    }
  }

  private async tick() {
    if (this.busy) return; // a slow batch must not overlap the next beat
    this.busy = true;
    try {
      await this.dailyPlan();
      const r = await this.queue.runDue(3).catch((e) => { this.logger.warn(`Worker failed: ${(e as Error).message}`); return null; });
      if (r && r.ran) this.logger.log(`Worker: ${r.ran} job(s) — ${r.ok} ok, ${r.failed} failed.`);
      await this.monthClose();
    } finally {
      this.busy = false;
    }
  }

  private async monthClose() {
    // Only act in the first 5 days of a month (draft the month that just ended),
    // and only once per calendar month per process.
    const now = new Date();
    if (now.getUTCDate() > 5) return; // UTC month, matching previousMonth()
    const stamp = `${now.getFullYear()}-${now.getMonth()}`;
    if (this.lastMonthRun === stamp) return;
    try {
      const r = await this.marketing.runMonthlyAutoGenerate();
      this.lastMonthRun = stamp;
      if (r.generated > 0) this.logger.log(`Drafted ${r.generated} report(s) for ${r.month}.`);
    } catch (e) {
      this.logger.warn(`Auto-report tick failed: ${(e as Error).message}`);
    }
  }
}
