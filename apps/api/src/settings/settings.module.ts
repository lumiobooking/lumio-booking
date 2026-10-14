import { OAuthGate } from '../common/oauth-gate.service';
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { GmailOAuthController } from './gmail-oauth.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController, GmailOAuthController],
  providers: [SettingsService, OAuthGate],
  exports: [SettingsService], // used by the public salon endpoint
})
export class SettingsModule {}
