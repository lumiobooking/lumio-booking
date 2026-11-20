import { Controller, Get } from '@nestjs/common';
import { timingReport } from './request-timing';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';
import { aiHealthReport, sharedAiHealth } from '../messenger/ai-health';

// Health check must be reachable WITHOUT authentication so platform probes
// (e.g. Render) get a 2xx instead of a 401.
const START_TIME = new Date().toISOString();

/**
 * How long the database gets to answer before this endpoint stops waiting.
 *
 * A liveness probe must never hang. This one used to `await` a `SELECT 1` with
 * no bound, which means a slow or unreachable database did not make the check
 * FAIL — it made the check never answer at all. Render then reports "timed out
 * waiting for internal health check", the deploy is marked failed, and a
 * perfectly healthy process is thrown away because a third party was slow.
 *
 * Two seconds is longer than a healthy query and far shorter than any platform
 * probe timeout, so the answer always arrives while still being honest about
 * what it found.
 */
const DB_TIMEOUT_MS = 2000;

/** Eight characters derived from the connection string. Same database → same
 *  eight characters; different database → different. Reveals nothing else. */
function dbFingerprint(): string {
  const url = process.env.DATABASE_URL || '';
  if (!url) return 'unset';
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Is the database answering, and did it answer in time?
   *
   * 'up' | 'down' | 'slow' — three states, not two, because they need three
   * different reactions. 'down' means the query failed and something is broken.
   * 'slow' means the query is still running past the deadline: the database is
   * probably waking up, and the right response is to report it and keep serving
   * rather than to hang.
   */
  private async databaseState(): Promise<'up' | 'down' | 'slow'> {
    let settled = false;
    const query = this.prisma.$queryRaw`SELECT 1`
      .then(() => { settled = true; return 'up' as const; })
      .catch(() => { settled = true; return 'down' as const; });
    const deadline = new Promise<'slow'>((resolve) => {
      const t = setTimeout(() => resolve('slow'), DB_TIMEOUT_MS);
      // unref so a pending timer can never hold the process open on shutdown.
      t.unref?.();
    });
    const state = await Promise.race([query, deadline]);
    // The losing query is deliberately left to finish on its own; attaching a
    // catch above means an eventual rejection cannot become an unhandled one.
    void settled;
    return state;
  }

  /**
   * rt224 — how far away the database is. Every Lumio screen asks the database
   * a dozen questions; each costs one round trip, so this number times twelve
   * is roughly the floor of a screen. Three pings, the fastest one reported
   * (the first can include opening a connection). Plus WHERE it is and HOW we
   * reach it, read from the connection string's host — the region code and
   * whether it is Neon's pooled endpoint, never the host, user or password.
   */
  private async dbLink(): Promise<{ pingMs: number | null; region: string | null; pooled: boolean | null; connectionLimit: number | null }> {
    let best: number | null = null;
    for (let i = 0; i < 3; i += 1) {
      const t0 = Date.now();
      const ok = await Promise.race([
        this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        new Promise<boolean>((r) => { const t = setTimeout(() => r(false), 2000); t.unref?.(); }),
      ]);
      if (!ok) break;
      const ms = Date.now() - t0;
      best = best === null ? ms : Math.min(best, ms);
    }
    let region: string | null = null; let pooled: boolean | null = null; let connectionLimit: number | null = null;
    try {
      const u = new URL(String(process.env.DATABASE_URL ?? ''));
      region = (u.hostname.match(/\b((?:us|eu|ap|sa|ca|me|af)-[a-z]+-\d)\b/) ?? [])[1] ?? null;
      pooled = /-pooler\./.test(u.hostname);
      const cl = u.searchParams.get('connection_limit');
      connectionLimit = cl ? Number(cl) : null;
    } catch { /* not a URL: say nothing */ }
    return { pingMs: best, region, pooled, connectionLimit };
  }

  // GET /api/health -> liveness, plus what it could learn about the database.
  @Get()
  async check() {
    const database = await this.databaseState();
    const dbLink = database === 'up' ? await this.dbLink() : null;

    return {
      // 'ok' reports THIS PROCESS. The database gets its own field on purpose:
      // conflating them means a sleepy database can delete a working deploy.
      status: 'ok',
      service: 'lumio-booking-api',
      database,
      // Which build is actually serving. Without this, "is my fix deployed?"
      // can only be answered by guessing from behaviour.
      commit: (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7),
      // Which market this instance serves, and a fingerprint of WHICH database
      // it is attached to. The fingerprint is a hash, never the connection
      // string — but it is enough to answer the one question that matters
      // after setting up a second deployment: "are these two pointing at the
      // same database?" Two instances showing the same fingerprint would mean
      // the Vietnamese service is writing into the US data, which is the single
      // mistake the whole split exists to prevent.
      market: (process.env.MARKET || 'US').toUpperCase(),
      db: dbFingerprint(),
      dbLink,
      /**
       * WHETHER THE BRAIN IS ANSWERING.
       *
       * Every conversation on the platform runs through one API call, and this
       * endpoint said nothing about it — so when the account ran out of credit,
       * every bot on every channel sent a holding line for hours and the first
       * person to notice was a customer. Reported here, on the public probe,
       * so a free uptime monitor can watch `ai.ok` and ring a phone. A boolean
       * for whether a key exists, never the key; the category, never the API
       * body (it can quote a customer's message). See messenger/ai-health.
       */
      ai: aiHealthReport(sharedAiHealth(), Boolean(process.env.ANTHROPIC_API_KEY)),
      startedAt: START_TIME,
      // rt222: which routes were slow in the last 10 minutes, and whether the process itself stalled.
      perf: timingReport(),
      timestamp: new Date().toISOString(),
    };
  }
}
