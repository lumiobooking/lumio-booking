import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GoogleBookService } from './google-book.service';
import { dueToday } from './feed-schedule';

/**
 * Google asks for a full refresh of the feeds every day. This runs the build
 * + upload once a day at a quiet hour (03:10 UTC by default) when
 * RWG_FEED_AUTORUN=true — and only uploads when the SFTP credentials from the
 * Partner Portal are set; otherwise it just builds, so the readiness board
 * always has today's files to download.
 */
@Injectable()
export class GoogleBookScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GoogleBook');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly svc: GoogleBookService) {}

  onModuleInit() {
    const enabled = process.env.RWG_FEED_AUTORUN ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') { this.logger.log('Daily Google feed off (RWG_FEED_AUTORUN=true to enable).'); return; }
    const hour = Number(process.env.RWG_FEED_HOUR_UTC ?? 3);
    let running = false;
    const tick = async () => {
      if (running) return;
      const now = new Date();
      const last = await this.svc.lastRunStored();
      if (!dueToday(now, hour, last)) return;
      running = true;
      try {
        const r = await this.svc.runDaily(now);
        this.logger.log(`Daily feed: ${r.ready} ready, ${r.held} held, uploaded=${r.uploaded}${r.error ? ` (${r.error})` : ''}`);
      } finally { running = false; }
    };
    // Every five minutes, and once a minute after start: a deploy at 03:08 no
    // longer skips the day (./feed-schedule).
    this.timer = setInterval(() => { void tick().catch((e) => this.logger.error(String(e))); }, 5 * 60 * 1000);
    this.timer.unref?.();
    const first = setTimeout(() => { void tick().catch((e) => this.logger.error(String(e))); }, 60 * 1000);
    first.unref?.();
    this.logger.log(`Daily Google feed on (from ${hour}:00 UTC, once a day, catches up after restarts).`);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
