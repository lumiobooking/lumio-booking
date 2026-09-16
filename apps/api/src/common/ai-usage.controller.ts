import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiUsageService } from './ai-usage.service';

/**
 * "Why is the balance going down when nobody is using it?" — answered here.
 *
 * Super Admin only, and platform-wide by nature: it names every salon, which
 * is exactly what no salon-scoped screen may ever do.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get()
  report(@Query('days') days?: string) {
    return this.usage.report(Number(days) || 7);
  }
}
