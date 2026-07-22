import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { MarketingScheduler } from './marketing.scheduler';
import { SocialRegistry } from './connectors/social-registry';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, MarketingScheduler, SocialRegistry],
})
export class MarketingModule {}
