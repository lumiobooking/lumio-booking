import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * Sends automated appointment reminders on an interval (no-show reduction).
 * Per-salon reminders are OFF by default, so this dispatcher never messages
 * anyone until a salon turns reminders on in Settings. Disable the whole
 * dispatcher with REMINDERS_ENABLED=false.
 *
 * Note: on Render's free tier the instance sleeps when idle, so reminders fire
 * while the app is awake (kept warm by the keep-alive window). For minute-exact
 * delivery an external cron hitting the app would be needed — fine for salons
 * where "a reminder that morning / a few hours before" is the goal.
 */
@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 10 * 60 * 1000; // every 10 minutes

  constructor(private readonly bookings: BookingsService) {}

  onModuleInit() {
    const enabled = process.env.REMINDERS_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Reminder dispatcher disabled (set REMINDERS_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 40 * 1000); // first run shortly after boot
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Reminder dispatcher on (every ${this.intervalMs / 60000}m).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const r = await this.bookings.processDueReminders();
      if (r.sent > 0) this.logger.log(`Sent ${r.sent} reminder(s).`);
    } catch (e) {
      this.logger.warn(`Reminder tick failed: ${(e as Error).message}`);
    }
    // Same cadence: nudge mid-service customers for a Google review (opt-in per salon).
    try {
      const rv = await this.bookings.processDueReviewRequests();
      if (rv.sent > 0) this.logger.log(`Sent ${rv.sent} review request(s).`);
    } catch (e) {
      this.logger.warn(`Review-request tick failed: ${(e as Error).message}`);
    }
    // Retention: "time for a refill" reminders (opt-in per salon).
    try {
      const rb = await this.bookings.processDueRebookingReminders();
      if (rb.sent > 0) this.logger.log(`Sent ${rb.sent} rebooking reminder(s).`);
    } catch (e) {
      this.logger.warn(`Rebooking tick failed: ${(e as Error).message}`);
    }
  }
}
