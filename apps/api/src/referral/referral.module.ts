import { Module } from '@nestjs/common';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';

@Module({
  imports: [LoyaltyModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
