import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';
import { MessengerWebhookController } from './messenger-webhook.controller';

@Module({
  imports: [BookingsModule, SettingsModule],
  controllers: [MessengerController, MessengerWebhookController],
  providers: [MessengerService],
  exports: [MessengerService],
})
export class MessengerModule {}
