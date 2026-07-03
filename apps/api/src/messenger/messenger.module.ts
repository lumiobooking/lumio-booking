import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';
import { MessengerWebhookController } from './messenger-webhook.controller';

@Module({
  imports: [BookingsModule],
  controllers: [MessengerController, MessengerWebhookController],
  providers: [MessengerService],
  exports: [MessengerService],
})
export class MessengerModule {}
