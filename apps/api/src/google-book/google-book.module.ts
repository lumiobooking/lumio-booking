import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { GoogleReviewsModule } from '../google-reviews/google-reviews.module';
import { GoogleBookService } from './google-book.service';
import { GoogleBookController } from './google-book.controller';
import { GoogleBookScheduler } from './google-book.scheduler';

/** Google "Book online" for every salon: the daily Actions Center feed and the agency's readiness board. */
@Module({
  imports: [SettingsModule, GoogleReviewsModule],
  controllers: [GoogleBookController],
  providers: [GoogleBookService, GoogleBookScheduler],
  exports: [GoogleBookService],
})
export class GoogleBookModule {}
