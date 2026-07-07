import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VoiceModule } from '../voice/voice.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { InvoicesService } from './invoices.service';
import { InvoicesScheduler } from './invoices.scheduler';
import { PublicInvoicesController, SalonInvoicesController, AdminInvoicesController } from './invoices.controller';

@Module({
  imports: [PrismaModule, VoiceModule, NotificationsModule, BillingModule],
  controllers: [PublicInvoicesController, SalonInvoicesController, AdminInvoicesController],
  providers: [InvoicesService, InvoicesScheduler],
  exports: [InvoicesService],
})
export class InvoicesModule {}
