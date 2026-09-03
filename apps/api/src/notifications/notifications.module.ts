import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EsmsCallbackController } from './esms-callback.controller';

@Module({
  controllers: [NotificationsController, EsmsCallbackController],
  providers: [NotificationsService],
  exports: [NotificationsService], // used by BookingsService for confirmations
})
export class NotificationsModule {}
