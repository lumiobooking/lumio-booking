import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * Dispatches automated marketing campaigns (win-back, reactivation, birthday) on
 * an hourly tick. Each tenant only sends during its configured send-hour, and
 * campaigns are OFF by default, so nothing goes out until a salon opts in.
 * Disable the whole dispatcher with CAMPAIGNS_ENABLED=false. Same warm-window
 * caveat as reminders on Render's free tier.
 */
@Injectable()
export class CampaignsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Campaigns');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 60 * 60 * 1000; // hourly (per-tenant send-hour gates the actual send)

  constructor(private readonly campaigns: CampaignsService) {}

  onModuleInit() {
    const enabled = process.env.CAMPAIGNS_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Campaign dispatcher disabled (set CAMPAIGNS_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 70 * 1000); // shortly after boot (after the reminder dispatcher)
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Campaign dispatcher on (every ${this.intervalMs / 60000}m).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const r = await this.campaigns.runDue();
      if (r.sent > 0) this.logger.log(`Sent ${r.sent} campaign message(s).`);
    } catch (e) {
      this.logger.warn(`Campaign tick failed: ${(e as Error).message}`);
    }
  }
}
