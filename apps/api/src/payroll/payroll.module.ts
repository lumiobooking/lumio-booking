import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { MyPayController } from './my-pay.controller';
import { TimeClockController } from './time-clock.controller';
import { TimeClockService } from './time-clock.service';

@Module({
  controllers: [PayrollController, MyPayController, TimeClockController],
  providers: [PayrollService, TimeClockService],
  exports: [PayrollService],
})
export class PayrollModule {}
