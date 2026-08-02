import { Controller, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RetentionService } from './retention.service';

/** Platform housekeeping. Super Admin only — this is not a per-salon setting. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly retention: RetentionService) {}

  /** Run the retention sweep now and report exactly what it removed. */
  @Post('retention/run')
  @HttpCode(200)
  run() {
    return this.retention.sweep();
  }
}
