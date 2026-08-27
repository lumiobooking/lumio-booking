import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InboxEventsService } from './inbox-events.service';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';
import { MessengerWebhookController } from './messenger-webhook.controller';

@Module({
  imports: [BookingsModule, SettingsModule, NotificationsModule],
  controllers: [MessengerController, MessengerWebhookController],
  providers: [InboxEventsService, MessengerService],
  exports: [InboxEventsService, MessengerService],
})
export class MessengerModule {}
