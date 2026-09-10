import { Module } from '@nestjs/common';
import { TikTokService } from './tiktok.service';
import { TikTokController, TikTokOAuthController } from './tiktok.controller';

/** The client's TikTok account, connected once and posted to by the calendar. */
@Module({
  controllers: [TikTokController, TikTokOAuthController],
  providers: [TikTokService],
  exports: [TikTokService],
})
export class TikTokModule {}
