import { OAuthGate } from '../common/oauth-gate.service';
import { Module } from '@nestjs/common';
import { TikTokService } from './tiktok.service';
import { TikTokController, TikTokOAuthController } from './tiktok.controller';

/** The client's TikTok account, connected once and posted to by the calendar. */
@Module({
  controllers: [TikTokController, TikTokOAuthController],
  providers: [TikTokService, OAuthGate],
  exports: [TikTokService],
})
export class TikTokModule {}
