import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { TrashService } from './trash.service';
import { MaintenanceController } from './maintenance.controller';
import { TrashController } from './trash.controller';

@Module({
  controllers: [MaintenanceController, TrashController],
  providers: [RetentionService, TrashService],
  exports: [RetentionService, TrashService],
})
export class MaintenanceModule {}
