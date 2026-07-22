import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MarketingService } from './marketing.service';

/**
 * Month-end auto-drafting of marketing reports. Ticks a few times a day; when
 * it sees we are in the first days of a new month, it drafts LAST month's report
 * for every active salon that has activity — leaving each in 'review' so a human
 * approves before a client ever sees it. Idempotent: existing reports are
 * skipped, so repeated ticks are harmless.
 *
 * OFF unless MARKETING_AUTOREPORT_ENABLED=true (defaults on in production, like
 * the campaigns dispatcher). Same Render warm-window caveat as other schedulers.
 */
@Injectable()
export class MarketingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MarketingAutoReport');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 12 * 60 * 60 * 1000; // every 12h
  private lastMonthRun: string | null = null;

  constructor(private readonly marketing: MarketingService) {}

  onModuleInit() {
    const enabled = process.env.MARKETING_AUTOREPORT_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Auto-report disabled (set MARKETING_AUTOREPORT_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 90 * 1000); // shortly after boot
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Auto-report scheduler on (every ${this.intervalMs / 3600000}h).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    // Only act in the first 5 days of a month (draft the month that just ended),
    // and only once per calendar month per process.
    const now = new Date();
    if (now.getDate() > 5) return;
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
