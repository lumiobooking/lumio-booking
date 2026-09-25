import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EsmsCallbackController } from './esms-callback.controller';
import { TwilioInboundController } from './twilio-inbound.controller';

@Module({
  controllers: [NotificationsController, EsmsCallbackController, TwilioInboundController],
  providers: [NotificationsService],
  exports: [NotificationsService], // used by BookingsService for confirmations
})
export class NotificationsModule {}
