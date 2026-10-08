import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { MarketingScheduler } from './marketing.scheduler';
import { SocialPostsService } from './social-posts.service';
import { SocialRegistry } from './connectors/social-registry';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [MarketingController],
  providers: [MarketingService, MarketingScheduler, SocialRegistry, SocialPostsService],
  exports: [SocialPostsService],
})
export class MarketingModule {}
