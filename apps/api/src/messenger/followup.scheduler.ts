import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MessengerService } from './messenger.service';

/**
 * Every 5 minutes: the follow-up sweep for quiet booking chats — ONLY for the
 * salons that switched it on in their Messenger settings (off by default).
 * Rules in ./followup; sending in MessengerService.sendFollowUpsFor.
 * CHAT_FOLLOWUP_ENABLED=false stops the sweep for everyone at once.
 */
@Injectable()
export class ChatFollowUpScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ChatFollowUp');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(private readonly messenger: MessengerService) {}

  onModuleInit() {
    const enabled = process.env.CHAT_FOLLOWUP_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Chat follow-up sweep disabled (set CHAT_FOLLOWUP_ENABLED=true to enable).');
      return;
    }
    setTimeout(() => void this.tick(), 90 * 1000).unref?.();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Chat follow-up sweep on (every ${this.intervalMs / 60000}m, salons that opted in).`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const r = await this.messenger.sendFollowUpsEverywhere();
      if (r.sent) this.logger.log(`Sent ${r.sent} follow-up(s) across ${r.salons} salon(s).`);
    } catch (e) {
      this.logger.warn(`Follow-up sweep failed: ${(e as Error).message}`);
    }
  }
}
