import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { GoogleReviewsService } from './google-reviews.service';
import { GoogleReviewsController } from './google-reviews.controller';
import { GoogleReviewsOAuthController } from './google-reviews-oauth.controller';
import { GoogleReviewsScheduler } from './google-reviews.scheduler';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [GoogleReviewsController, GoogleReviewsOAuthController],
  providers: [GoogleReviewsService, GoogleReviewsScheduler],
  exports: [GoogleReviewsService],
})
export class GoogleReviewsModule {}
