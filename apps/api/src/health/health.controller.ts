import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

// Health check must be reachable WITHOUT authentication so platform probes
// (e.g. Render) get a 2xx instead of a 401.
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
      timestamp: new Date().toISOString(),
    };
  }
}
