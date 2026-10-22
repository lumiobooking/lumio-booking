import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PaymentsHubModule } from '../payments-hub/payments-hub.module';

@Module({
  imports: [LoyaltyModule, PaymentsHubModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
