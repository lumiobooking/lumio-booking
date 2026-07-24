import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Keep-alive (anti cold-start) for Render's free tier.
 *
 * Render free web services spin down after ~15 min with no inbound traffic, so
 * the next visitor waits 30–60s for a cold "waking up". This service keeps both
 * the API and the web app warm by pinging their public URLs on an interval.
 *
 * To respect the free tier's 750 instance-hours/month budget (two services kept
 * awake 24/7 would exceed it), pings only fire inside a configurable
 * business-hours window. Outside that window the services are allowed to sleep.
 *
 * Note: an internal timer can KEEP a service awake but cannot WAKE it from cold
 * (the process is suspended while asleep), so the first visit each morning may
 * still be cold. An external pinger (e.g. cron-job.org) scheduled to the same
 * window removes that one morning cold start — see DEPLOY.md.
 *
 * Disable entirely with KEEPALIVE_ENABLED=false (e.g. once on a paid plan that
 * never sleeps).
 */
@Injectable()
export class KeepaliveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Keepalive');
  private timer: NodeJS.Timeout | null = null;

  // Ping every 4 minutes. This warms /api/health (which runs SELECT 1), keeping
  // the Postgres (Neon) compute AWAKE — Neon auto-suspends after ~5 min idle, so
  // a 12-min ping let the DB sleep between pings and the next visitor hit a cold
  // 1–3s wake. 4 min stays safely under the 5-min suspend.
  private readonly intervalMs = 4 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    const enabled = this.config.get<string>('KEEPALIVE_ENABLED') ?? (isProd ? 'true' : 'false');
    if (enabled !== 'true') {
      this.logger.log('Keep-alive disabled (not production / KEEPALIVE_ENABLED!=true).');
      return;
    }

    const targets = this.targets();
    if (targets.length === 0) {
      this.logger.log('Keep-alive idle: no SELF/WEB URL configured (fine for local dev).');
      return;
    }

    const { start, end, tz } = this.window();
    this.logger.log(
      `Keep-alive on. Pinging ${targets.length} URL(s) every ${this.intervalMs / 60000}m, ` +
        `window ${start}:00–${end}:00 (${tz}).`,
    );

    // Kick once shortly after boot, then on the interval.
    setTimeout(() => this.tick(), 20 * 1000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Don't let the timer keep the process alive on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private targets(): string[] {
    const urls: string[] = [];
    // Render injects RENDER_EXTERNAL_URL automatically; fall back to KEEPALIVE_SELF_URL.
    // Public service URLs (not secrets). Env vars override these defaults so the
    // keep-alive works out of the box even if the blueprint env isn't synced yet.
    const self =
      this.config.get<string>('KEEPALIVE_SELF_URL') ??
      this.config.get<string>('RENDER_EXTERNAL_URL') ??
      'https://lumio-api-uqm6.onrender.com';
    const web =
      this.config.get<string>('KEEPALIVE_WEB_URL') ??
      'https://lumio-web-1xqk.onrender.com';
    if (self) urls.push(`${self.replace(/\/$/, '')}/api/health`);
    if (web) urls.push(`${web.replace(/\/$/, '')}/healthz`);
    return urls;
  }

  private window(): { start: number; end: number; tz: string } {
    // Default 24/7 (start=0,end=24) so the DB never suspends — correct on a paid
    // instance with no free-hour budget. If a deployment is back on Render's free
    // tier, set KEEPALIVE_START_HOUR / KEEPALIVE_END_HOUR to a narrower window.
    const start = Number(this.config.get<string>('KEEPALIVE_START_HOUR') ?? 0);
    const end = Number(this.config.get<string>('KEEPALIVE_END_HOUR') ?? 24);
    const tz = this.config.get<string>('KEEPALIVE_TZ') ?? 'America/New_York';
    return { start, end, tz };
  }

  /** Current hour (0–23) in the configured timezone. */
  private hourNow(tz: string): number {
    try {
      const s = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz,
      }).format(new Date());
      const h = parseInt(s, 10);
      return Number.isNaN(h) ? new Date().getUTCHours() : h % 24;
    } catch {
      return new Date().getUTCHours();
    }
  }

  private async tick() {
    const { start, end, tz } = this.window();
    const hour = this.hourNow(tz);
    // Active inside [start, end). Supports windows that wrap past midnight
    // (e.g. start=22, end=4) for multi-timezone coverage.
    const active = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!active) return; // outside business hours -> let it sleep to save free hours

    for (const url of this.targets()) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 20 * 1000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(to);
        this.logger.debug(`ping ${url} -> ${res.status}`);
      } catch (err) {
        this.logger.warn(`ping ${url} failed: ${(err as Error).message}`);
      }
    }
  }
}
