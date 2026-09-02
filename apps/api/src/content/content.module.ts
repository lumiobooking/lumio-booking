import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ContentService } from './content.service';
import { ContentAdminService } from './content-admin.service';
import { ContentChatService } from './content-chat.service';
import { PostReviewService } from './post-review.service';
import { PublicReviewController } from './public-review.controller';
import { SocialPublishService } from './social-publish.service';
import { MEDIA_STORE } from './media-store';
import { UploadsService } from '../uploads/uploads.service';
import { ContentController, ContentAdminController } from './content.controller';
import { ContentScheduler } from './content.scheduler';
import { TrendFeedService } from './trends/trend-feed.service';

@Module({
  imports: [SettingsModule, UploadsModule],
  controllers: [ContentController, ContentAdminController, PublicReviewController],
  providers: [
    ContentService, ContentAdminService, ContentChatService, SocialPublishService, ContentScheduler, TrendFeedService, PostReviewService,
    // The compiler checks here that UploadsService really satisfies the port,
    // so the two-line stub used in tests cannot drift away from the real thing.
    { provide: MEDIA_STORE, useExisting: UploadsService },
  ],
  exports: [ContentService],
})
export class ContentModule {}
