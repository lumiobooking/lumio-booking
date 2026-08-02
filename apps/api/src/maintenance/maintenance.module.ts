import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { TrashService } from './trash.service';
import { MaintenanceController } from './maintenance.controller';

@Module({
  controllers: [MaintenanceController],
  providers: [RetentionService, TrashService],
  exports: [RetentionService, TrashService],
})
export class MaintenanceModule {}
