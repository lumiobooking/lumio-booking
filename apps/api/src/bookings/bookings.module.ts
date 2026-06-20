import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ReminderService } from './reminder.service';
import { AssignmentModule } from '../assignment/assignment.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AssignmentModule, NotificationsModule, SettingsModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, ReminderService],
  exports: [BookingsService], // reused by PublicModule (WordPress plugin flow)
})
export class BookingsModule {}
