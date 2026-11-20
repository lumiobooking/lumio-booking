/**
 * rt222 — "hệ thống cứ bị báo máy chủ đang khởi động liên tục". That notice is
 * the web app saying a request took longer than 6 s; to fix it we must know
 * WHICH requests are slow and whether the process itself is stalled. This
 * keeps, in memory, the last 10 minutes of request timings by ROUTE PATTERN
 * (e.g. GET /api/messenger/threads/:id — never ids, queries, bodies or who
 * asked) and the event-loop delay, reported on /api/health. Nothing per salon,
 * nothing personal.
 */
import { monitorEventLoopDelay } from 'perf_hooks';

type Sample = { at: number; key: string; ms: number; status: number };
const WINDOW_MS = 10 * 60_000;
const MAX = 20_000;
const samples: Sample[] = [];
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let loopMaxSeen = 0;
setInterval(() => { loopMaxSeen = Math.max(loopMaxSeen * 0.5, loop.max / 1e6); loop.reset(); }, 60_000).unref?.();

/** "GET /api/messenger/threads/:id" from Express's matched route; unknown paths collapse to one bucket. */
export function routeKey(method: string, baseUrl: string | undefined, routePath: string | undefined): string {
  const path = routePath ? `${baseUrl ?? ''}${routePath}` : '(unmatched)';
  return `${String(method || 'GET').toUpperCase()} ${path}`.slice(0, 160);
}

/** Long-polls wait on purpose (the print agent asks "any job?" and holds 25 s): not slowness. */
const LONG_POLL = /print-agent\/jobs$/;

export function recordTiming(key: string, ms: number, status: number, now = Date.now()): void {
  if (LONG_POLL.test(key)) return;
  samples.push({ at: now, key, ms, status });
  if (samples.length > MAX) samples.splice(0, samples.length - MAX);
}

/** The slowest routes of the last 10 minutes, by p95, plus the event-loop delay. */
export function timingReport(now = Date.now(), top = 8) {
  while (samples.length && samples[0].at < now - WINDOW_MS) samples.shift();
  const by = new Map<string, number[]>();
  let slow = 0;
  for (const s of samples) {
    let a = by.get(s.key); if (!a) { a = []; by.set(s.key, a); }
    a.push(s.ms);
    if (s.ms >= 6000) slow += 1;
  }
  const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor((b.length - 1) * p))]; };
  const routes = [...by.entries()].map(([key, a]) => ({ route: key, n: a.length, p50: Math.round(pct(a, 0.5)), p95: Math.round(pct(a, 0.95)), max: Math.round(Math.max(...a)) }))
    .sort((x, y) => y.p95 - x.p95).slice(0, top);
  const mem = process.memoryUsage();
  return {
    requests10m: samples.length,
    over6s10m: slow,
    eventLoopDelayMs: { p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(Math.max(loopMaxSeen, loop.max / 1e6)) },
    memoryMb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    slowest: routes,
    // rt226: what is asked most often — a screen re-reading itself shows up here, not in "slowest".
    busiest: [...by.entries()].map(([key, a]) => ({ route: key, n: a.length, p50: Math.round(pct(a, 0.5)) })).sort((x, y) => y.n - x.n).slice(0, top),
  };
}

/** Express middleware: time every request; recorded when the response finishes. */
export function timingMiddleware(req: { method: string; baseUrl?: string; route?: { path?: string } }, res: { on: (e: string, f: () => void) => void; statusCode: number }, next: () => void): void {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    recordTiming(routeKey(req.method, req.baseUrl, req.route?.path), ms, res.statusCode);
  });
  next();
}
