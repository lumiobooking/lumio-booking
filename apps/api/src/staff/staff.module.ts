import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PosModule } from '../pos/pos.module';

@Module({
  imports: [PosModule], // staff performance reuses the POS revenue/tips report
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}