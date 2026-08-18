import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

// Health check must be reachable WITHOUT authentication so platform probes
// (e.g. Render) get a 2xx instead of a 401.
const START_TIME = new Date().toISOString();

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

  // GET /api/health -> basic liveness + database connectivity check.
  @Get()
  async check() {
    let database = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
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
