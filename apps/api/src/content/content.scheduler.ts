import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContentService } from './content.service';

/**
 * Drafts tomorrow's ideas while the salons sleep.
 *
 * Deliberately drafts, never publishes: the Lumio team presses the button.
 * Ticks hourly rather than firing once at a fixed hour, because Render's free
 * tier sleeps and a single daily alarm would be missed on exactly the mornings
 * nobody was using the app — the mornings a plan matters most. Generation is
 * idempotent per (tenant, local date), so extra ticks cost nothing.
 */
@Injectable()
export class ContentScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ContentPlanner');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 60 * 60 * 1000;
  private running = false;

  constructor(private readonly content: ContentService) {}

  onModuleInit() {
    const enabled = process.env.CONTENT_PLANNER_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Content planner disabled (set CONTENT_PLANNER_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 120 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log('Content planner on (hourly; drafts once per salon per local day).');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // a slow run must not stack on itself
    this.running = true;
    try {
      const r = await this.content.generateAll('SALON');
      if (r.created) this.logger.log(`Drafted ${r.created} ideas across ${r.tenants} salons.`);
    } catch (e) {
      this.logger.warn(`planner tick failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.running = false;
    }
  }
}
