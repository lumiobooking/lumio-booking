import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { MaintenanceController } from './maintenance.controller';

@Module({
  controllers: [MaintenanceController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class MaintenanceModule {}
