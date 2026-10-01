import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { UploadsModule } from '../uploads/uploads.module';
import { FeedbackController, PublicFeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { FeedbackDispatcher } from './feedback.dispatcher';

@Module({
  imports: [SettingsModule, NotificationsModule, PushModule, UploadsModule],
  controllers: [PublicFeedbackController, FeedbackController],
  providers: [FeedbackService, FeedbackDispatcher],
  exports: [FeedbackService], // the till creates a request on every paid sale
})
export class FeedbackModule {}
