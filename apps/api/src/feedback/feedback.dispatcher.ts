import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

/**
 * Texts the "how was your visit?" link to customers who did not answer on the
 * salon iPad, once their delay has passed, and retires links nobody used.
 * Same switch as the reminder dispatcher (REMINDERS_ENABLED), so a staging box
 * never texts real customers.
 */
@Injectable()
export class FeedbackDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FeedbackSms');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 2 * 60 * 1000;

  constructor(private readonly feedback: FeedbackService) {}

  onModuleInit() {
    const enabled = process.env.REMINDERS_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Feedback texts disabled (set REMINDERS_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 50 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const r = await this.feedback.processDue();
      if (r.sent || r.expired) this.logger.log(`Feedback: ${r.sent} text(s) sent, ${r.expired} link(s) expired.`);
    } catch (e) {
      this.logger.warn(`Feedback tick failed: ${(e as Error).message}`);
    }
  }
}
