import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailCampaignsService } from './email-campaigns.service';

/**
 * The follow-up sweep. Runs once a day (same pattern as the invoice sweep — a plain
 * timer, no extra dependency).
 *
 * The cadence is PER PERSON, not per calendar: a contact only gets the next letter
 * once their own gap (e.g. 30 days) has passed. Anyone who replied, unsubscribed, or
 * finished the sequence is skipped — so running this twice in a day changes nothing.
 */
@Injectable()
export class EmailAutomationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EmailAutomation');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 24 * 60 * 60 * 1000;

  constructor(private readonly svc: EmailCampaignsService) {}

  onModuleInit() {
    const enabled = process.env.EMAIL_AUTOMATION_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('follow-up automation disabled (set EMAIL_AUTOMATION_ENABLED=true to run it)');
      return;
    }
    // Wait a couple of minutes after boot so a deploy doesn't fire mail mid-restart.
    setTimeout(() => void this.run(), 2 * 60 * 1000);
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    this.logger.log('follow-up automation armed (daily)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    try {
      await this.svc.runAllAutomations();
    } catch (e) {
      this.logger.error(`daily run failed: ${String(e).slice(0, 200)}`);
    }
  }
}
