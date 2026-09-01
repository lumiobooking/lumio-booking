import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContentService } from './content.service';
import { SocialPublishService } from './social-publish.service';
import { TrendFeedService } from './trends/trend-feed.service';

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
  private trendTimer: NodeJS.Timeout | null = null;
  private readonly trendIntervalMs = 60 * 60 * 1000;
  private trendRunning = false;

  constructor(
    private readonly content: ContentService,
    private readonly publisher: SocialPublishService,
    private readonly trends: TrendFeedService,
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

    // Trends refresh is the same kind of job as publishing: no AI bill, and a
    // promise to the user — "the board updates itself every day" — that must
    // hold on every deployment, so it does not sit behind the drafting flag.
    // Each pull checks its own age (>=20h) first, so the hourly timer costs a
    // few reads and no API calls on the 23 hours it has nothing to do.
    setTimeout(() => this.sweepTrends(), 90 * 1000);
    this.trendTimer = setInterval(() => this.sweepTrends(), this.trendIntervalMs);
    this.trendTimer.unref?.();
    this.logger.log('Trend feeds: refreshing daily (checked hourly).');

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
    if (this.trendTimer) clearInterval(this.trendTimer);
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

  /** What is trending in each trade, once a day per trade and market. */
  private async sweepTrends() {
    if (this.trendRunning) return;
    this.trendRunning = true;
    try {
      const tr = await this.trends.refreshAll();
      if (tr.pulls || tr.instagram) this.logger.log(`Trends refreshed: ${tr.pulls} shared feed(s), ${tr.instagram} Instagram account(s).`);
    } catch (e) {
      this.logger.warn(`trend sweep failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.trendRunning = false;
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
      // Housekeeping, on the slow clock: uploaded pictures of posts that went
      // out long ago. Meta kept its own copy, so nothing on any Page changes —
      // this is the difference between storage that grows for ever and storage
      // that holds only what is still waiting to publish.
      const m = await this.publisher.purgeOldMedia().catch(() => ({ files: 0, posts: 0 }));
      if (m.files) this.logger.log(`Media retention: ${m.files} file(s) removed from storage.`);
    } catch (e) {
      this.logger.warn(`planner tick failed: ${String(e).slice(0, 160)}`);
    } finally {
      this.running = false;
    }
  }
}
