import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { LeadFollowUpScheduler } from './follow-up.scheduler';
import { PushModule } from '../push/push.module';

@Module({
  imports: [MaintenanceModule, PushModule],
  controllers: [CustomersController],
  providers: [CustomersService, LeadFollowUpScheduler],
  exports: [CustomersService],
})
export class CustomersModule {}
