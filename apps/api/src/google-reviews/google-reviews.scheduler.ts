import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GoogleReviewsService } from './google-reviews.service';

/**
 * Auto-syncs Google reviews on a background tick so salons don't have to press
 * "Sync". Every connected tenant with auto-processing ON gets pulled ~every 15
 * minutes: new positive reviews are drafted (AI) and low/neutral ones email the
 * manager — near real-time. Disable with GOOGLE_REVIEWS_AUTOSYNC=false.
 * (Render free tier sleeps between requests, so keep the service warm for this.)
 */
@Injectable()
export class GoogleReviewsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GoogleReviews');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 15 * 60 * 1000; // every 15 minutes

  constructor(private readonly svc: GoogleReviewsService) {}

  onModuleInit() {
    const enabled = process.env.GOOGLE_REVIEWS_AUTOSYNC ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Review auto-sync disabled (set GOOGLE_REVIEWS_AUTOSYNC=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 90 * 1000); // shortly after boot
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Review auto-sync on (every ${this.intervalMs / 60000}m).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const r = await this.svc.syncAllConnected();
      if (r.drafted || r.alerted) {
        this.logger.log(`Auto-sync: ${r.tenants} tenant(s) · ${r.drafted} drafted · ${r.alerted} alerted.`);
      }
    } catch (e) {
      this.logger.warn(`Auto-sync tick failed: ${(e as Error).message}`);
    }
  }
}
