import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WalkinsService } from './walkins.service';

/**
 * THE FLOOR TIDIES ITSELF. A visit nobody closed ("107′" on a 60-minute
 * service) kept its technician "busy" until someone remembered. Every few
 * minutes this parks, for every salon, the visits that are late by the grace
 * period on every running leg, or still in a chair an hour after closing, at
 * "waiting to pay" — the bill stays open, the chair is free.
 * Once the salon's day has moved on, what is still parked at the till closes
 * as Done on its own day, with no order (walkins/unpaid-sweep.ts).
 * Disable with HOUSEKEEPING_ENABLED=false.
 */
@Injectable()
export class WalkinsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Housekeeping');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(private readonly walkins: WalkinsService) {}

  onModuleInit() {
    const enabled = process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') return;
    setTimeout(() => this.tick(), 75 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Walk-in housekeeping on (every ${this.intervalMs / 60000}m).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const r = await this.walkins.parkStaleEverywhere();
      if (r.parked) this.logger.log(`Parked ${r.parked} stale visit(s) at the till.`);
    } catch (e) {
      this.logger.warn(`Stale-visit sweep failed: ${(e as Error).message}`);
    }
    // A new salon day starts with an empty "waiting to pay" (walkins/unpaid-sweep.ts).
    try {
      const r = await this.walkins.closeUnpaidEverywhere();
      if (r.closed) this.logger.log(`Closed ${r.closed} unpaid visit(s) from earlier days.`);
    } catch (e) {
      this.logger.warn(`Unpaid-visit sweep failed: ${(e as Error).message}`);
    }
  }
}
