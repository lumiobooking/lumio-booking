import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { MyPayController } from './my-pay.controller';

@Module({
  controllers: [PayrollController, MyPayController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
