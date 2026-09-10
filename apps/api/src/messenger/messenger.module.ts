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
import { WebChatService } from './web-chat.service';
import { WebChatAdminController, WebChatPublicController } from './web-chat.controller';

@Module({
  imports: [BookingsModule, SettingsModule, NotificationsModule, PushModule],
  controllers: [MessengerController, MessengerWebhookController, ZaloController, ZaloWebhookController, SiteVerificationController, WebChatAdminController, WebChatPublicController],
  providers: [InboxEventsService, MessengerService, ZaloOaService, WebChatService],
  exports: [InboxEventsService, MessengerService],
})
export class MessengerModule {}
