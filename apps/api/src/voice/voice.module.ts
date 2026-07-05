import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { VoiceService } from './voice.service';
import { VoiceController, VoiceAdminController } from './voice.controller';
import { VoiceWebhookController } from './voice-webhook.controller';

@Module({
  imports: [BookingsModule, SettingsModule],
  controllers: [VoiceController, VoiceAdminController, VoiceWebhookController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
