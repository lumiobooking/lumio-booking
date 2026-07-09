import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Dependency-free, in-memory sliding-window rate limiter. Registered as a global
 * APP_GUARD so EVERY route gets a default budget; sensitive public routes tighten
 * it with @RateLimit and high-volume webhooks opt out with @SkipRateLimit.
 *
 * Keyed by (client IP + method + route), so one abuser can't exhaust a route for
 * everyone, and a burst on /auth/login is counted separately from /public/... .
 *
 * NOTE: state is per-process. The API runs as a single Render instance, so this
 * is sufficient. If the API is ever scaled to multiple instances, back this with
 * a shared store (Redis) so the window is global.
 */

export const RATE_LIMIT_KEY = 'lumio_rate_limit';
export const SKIP_RATE_LIMIT_KEY = 'lumio_skip_rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within the window, per client IP + route. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Tighten the budget for a single route or controller. */
export const RateLimit = (limit: number, windowMs = 60_000) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } as RateLimitOptions);

/** Exempt a route/controller (e.g. provider webhooks that legitimately burst). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

// Generous default so the authenticated dashboard is never hindered; public
// endpoints override this down to a few per minute.
const DEFAULT: RateLimitOptions = { limit: 150, windowMs: 60_000 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [handler, cls])) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Record<string, any>>();
    if (!req) return true;

    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [handler, cls]) ?? DEFAULT;
    const now = Date.now();
    this.sweep(now);

    const ip = this.clientIp(req);
    const route = (req.route && req.route.path) || req.originalUrl || req.url || '';
    const key = `${ip}|${req.method}:${route}`;

    const cutoff = now - opts.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= opts.limit) {
      const res = http.getResponse<Record<string, any>>();
      const retry = Math.max(1, Math.ceil((recent[0] + opts.windowMs - now) / 1000));
      if (res && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(retry));
      throw new HttpException('Too many requests. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Real client IP behind Render's proxy (X-Forwarded-For, first hop). */
  private clientIp(req: Record<string, any>): string {
    const xf = req.headers?.['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    if (Array.isArray(xf) && xf.length) return String(xf[0]).trim();
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  /** Drop stale buckets roughly once a minute so memory stays bounded. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, arr] of this.hits) {
      const recent = arr.filter((t) => t > now - 600_000);
      if (recent.length) this.hits.set(k, recent);
      else this.hits.delete(k);
    }
  }
}
