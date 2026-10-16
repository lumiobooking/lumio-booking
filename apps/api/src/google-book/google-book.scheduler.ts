import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GoogleBookService } from './google-book.service';

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
    const tick = async () => {
      const now = new Date();
      if (now.getUTCHours() !== hour || now.getUTCMinutes() >= 15) return;
      const last = this.svc.getLastRun();
      if (last && last.at.slice(0, 10) === now.toISOString().slice(0, 10)) return; // already ran today
      const r = await this.svc.runDaily(now);
      this.logger.log(`Daily feed: ${r.ready} ready, ${r.held} held, uploaded=${r.uploaded}${r.error ? ` (${r.error})` : ''}`);
    };
    this.timer = setInterval(() => { void tick().catch((e) => this.logger.error(String(e))); }, 10 * 60 * 1000);
    this.timer.unref?.();
    this.logger.log(`Daily Google feed on (around ${hour}:00 UTC).`);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
