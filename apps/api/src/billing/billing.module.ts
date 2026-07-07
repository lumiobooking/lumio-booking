import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { VoiceModule } from '../voice/voice.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PaypalService } from './paypal.service';
import { PlatformConfigService } from './platform-config.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuditModule, VoiceModule],
  controllers: [BillingController],
  providers: [BillingService, StripeService, PaypalService, PlatformConfigService],
  exports: [BillingService, StripeService, PlatformConfigService],
})
export class BillingModule {}
