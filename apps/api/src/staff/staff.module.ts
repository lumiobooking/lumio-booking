import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PosModule } from '../pos/pos.module';
import { PushModule } from '../push/push.module';
import { TimeOffController } from './time-off.controller';
import { TimeOffService } from './time-off.service';

@Module({
  imports: [PosModule, PushModule], // staff performance reuses the POS revenue/tips report; time off wakes the owner / the tech
  controllers: [StaffController, TimeOffController],
  providers: [StaffService, TimeOffService],
  exports: [TimeOffService],
})
export class StaffModule {}
