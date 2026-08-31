import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

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

  // GET /api/health -> liveness, plus what it could learn about the database.
  @Get()
  async check() {
    const database = await this.databaseState();

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
      startedAt: START_TIME,
      timestamp: new Date().toISOString(),
    };
  }
}
