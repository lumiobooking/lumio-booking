import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { GmailOAuthController } from './gmail-oauth.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController, GmailOAuthController],
  providers: [SettingsService],
  exports: [SettingsService], // used by the public salon endpoint
})
export class SettingsModule {}
