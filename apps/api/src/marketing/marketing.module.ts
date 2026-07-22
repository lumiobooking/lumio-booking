import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { MarketingScheduler } from './marketing.scheduler';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, MarketingScheduler],
})
export class MarketingModule {}
