import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContentService } from './content.service';
import { SocialPublishService } from './social-publish.service';

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

  /**
   * Posts are swept on their own, much faster clock.
   *
   * The planner ticks hourly, which is right for drafting tomorrow's ideas and
   * completely wrong for sending a post the salon scheduled for 9:00 — on an
   * hourly clock that lands anywhere in the following hour, and "roughly ten
   * o'clock-ish" is not what the person who chose 9:00 asked for.
   */
  private postTimer: NodeJS.Timeout | null = null;
  private readonly postIntervalMs = 60 * 1000;
  private postRunning = false;

  constructor(
    private readonly content: ContentService,
    private readonly publisher: SocialPublishService,
  ) {}

  onModuleInit() {
    // ---- publishing starts FIRST, and unconditionally ----
    //
    // These are two different jobs on one switch, and I wired them together.
    // CONTENT_PLANNER_ENABLED governs DRAFTING: it calls a paid AI API for every
    // salon every hour, so it is the flag somebody turns off to stop a bill.
    // Publishing is the opposite kind of job — the salon already approved these
    // posts and is waiting for them — and it costs nothing to run.
    //
    // Started before the planner's early return so that turning drafting off can
    // never silently stop posts the salon has already scheduled. A queue that
    // stops firing without saying so is worse than one that never existed.
    this.postTimer = setInterval(() => this.sweepPosts(), this.postIntervalMs);
    this.postTimer.unref?.();
    this.logger.log('Scheduled posts: sweeping every minute.');

    const enabled = process.env.CONTENT_PLANNER_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Content planner disabled (set CONTENT_PLANNER_ENABLED=true to enable). Scheduled posts still publish.');
      return;
    }
    setTimeout(() => this.tick(), 120 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log('Content planner on (hourly; drafts once per salon per local day).');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.postTimer) clearInterval(this.postTimer);
  }

  /** Send whatever is due. Never publishes anything the salon did not schedule. */
  private async sweepPosts() {
    if (this.postRunning) return;
    this.postRunning = true;
    try {
      await this.publisher.runDue();
    } catch (e) {
      this.logger.warn(`post sweep failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.postRunning = false;
    }
  }

  private async tick() {
    if (this.running) return; // a slow run must not stack on itself
    this.running = true;
    try {
      // Every industry, not just nail. Passing 'SALON' here is what silently
      // starved every non-salon client of content for as long as this ran.
      const r = await this.content.generateAll();
      if (r.created) this.logger.log(`Drafted ${r.created} ideas across ${r.tenants} salons.`);
      // Area demographics, filled here rather than on a page load. Cached for a
      // month, so almost every tick skips every tenant; the point is that no
      // human has to remember to press anything.
      const a = await this.content.warmAreas().catch(() => ({ warmed: 0 }));
      if (a.warmed) this.logger.log(`Area figures refreshed for ${a.warmed} salon(s).`);
      // Freeze each salon's week, so the archive exists whether or not anybody
      // opened the screen. A plan nobody looked at is still the plan that was
      // in force, and next Monday it is the only record of it.
      const w = await this.content.keepAllWeeks().catch(() => ({ kept: 0, outcomes: 0 }));
      if (w.kept) this.logger.log(`Week plan archived for ${w.kept} salon(s).`);
      // The results of a finished week, written once. Without this the archive
      // holds intentions and never says whether any of them worked.
      if (w.outcomes) this.logger.log(`Week results recorded for ${w.outcomes} salon(s).`);
    } catch (e) {
      this.logger.warn(`planner tick failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.running = false;
    }
  }
}
