import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientFormsService } from './client-forms.service';

/**
 * Texts the forms link to booked clients before their visit, for salons that
 * switched "send before the visit" on. Same switch as the reminder dispatcher
 * (REMINDERS_ENABLED), so a staging box never texts real clients.
 */
@Injectable()
export class ClientFormsDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ClientFormsSms');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 10 * 60 * 1000;

  constructor(private readonly forms: ClientFormsService) {}

  onModuleInit() {
    const enabled = process.env.REMINDERS_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') return;
    setTimeout(() => this.tick(), 90 * 1000).unref?.();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const r = await this.forms.processDue();
      if (r.sent) this.logger.log(`Forms: ${r.sent} link(s) texted.`);
    } catch (e) {
      this.logger.warn(`Forms tick failed: ${(e as Error).message}`);
    }
  }
}
