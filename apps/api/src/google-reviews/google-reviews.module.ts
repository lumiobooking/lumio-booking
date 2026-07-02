import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { GoogleReviewsService } from './google-reviews.service';
import { GoogleReviewsController } from './google-reviews.controller';
import { GoogleReviewsOAuthController } from './google-reviews-oauth.controller';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [GoogleReviewsController, GoogleReviewsOAuthController],
  providers: [GoogleReviewsService],
  exports: [GoogleReviewsService],
})
export class GoogleReviewsModule {}
