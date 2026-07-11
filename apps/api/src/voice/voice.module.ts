import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VoiceService } from './voice.service';
import { VoiceController, VoiceAdminController } from './voice.controller';
import { VoiceWebhookController } from './voice-webhook.controller';

@Module({
  imports: [BookingsModule, SettingsModule, NotificationsModule],
  controllers: [VoiceController, VoiceAdminController, VoiceWebhookController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
