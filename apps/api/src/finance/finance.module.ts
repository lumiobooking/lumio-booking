import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Thu & Chi. Reads sales through PosService so the P&L and Reports share one formula. */
@Module({
  imports: [PosModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
