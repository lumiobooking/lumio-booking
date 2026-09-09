import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushModule } from '../push/push.module';
import { InboxEventsService } from './inbox-events.service';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';
import { MessengerWebhookController } from './messenger-webhook.controller';
import { ZaloOaService } from './zalo-oa.service';
import { ZaloController, ZaloWebhookController } from './zalo.controller';
import { SiteVerificationController } from './site-verification.controller';

@Module({
  imports: [BookingsModule, SettingsModule, NotificationsModule, PushModule],
  controllers: [MessengerController, MessengerWebhookController, ZaloController, ZaloWebhookController, SiteVerificationController],
  providers: [InboxEventsService, MessengerService, ZaloOaService],
  exports: [InboxEventsService, MessengerService],
})
export class MessengerModule {}
