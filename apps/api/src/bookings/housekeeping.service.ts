import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * THE BOOK TIDIES ITSELF.
 *
 * Two kinds of booking used to hold a slot for ever unless a person noticed:
 *  - a booking handed to a technician who never tapped Accept — the 30-minute
 *    response deadline existed, but nothing ever enforced it;
 *  - a booking whose customer never came, left "Confirmed" on the calendar.
 * Every few minutes this sweeps both for every salon: silent technicians
 * lose the booking (reassigned, or back to Pending for the desk), and once a
 * salon's own day is over its untouched bookings become No-show.
 * Disable with HOUSEKEEPING_ENABLED=false.
 */
@Injectable()
export class HousekeepingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Housekeeping');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(private readonly bookings: BookingsService) {}

  onModuleInit() {
    const enabled = process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Booking housekeeping disabled (set HOUSEKEEPING_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => this.tick(), 60 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Booking housekeeping on (every ${this.intervalMs / 60000}m).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const r = await this.bookings.processTimeoutsEverywhere();
      if (r.processed) this.logger.log(`Response timeouts: ${r.processed} expired, ${r.reassigned} reassigned.`);
    } catch (e) {
      this.logger.warn(`Response-timeout sweep failed: ${(e as Error).message}`);
    }
    try {
      const r = await this.bookings.closeMissedEverywhere();
      if (r.closed) this.logger.log(`Marked ${r.closed} untouched past booking(s) as no-show.`);
    } catch (e) {
      this.logger.warn(`No-show sweep failed: ${(e as Error).message}`);
    }
  }
}
