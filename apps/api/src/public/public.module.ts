import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicSalonController } from './public-salon.controller';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsHubModule } from '../payments-hub/payments-hub.module';
import { OnlineDepositService } from './online-deposit.service';

// Reuses BookingsService + PaymentsService + SettingsService for both public
// flows: the API-key WordPress plugin (PublicController) and the slug-based
// hosted booking link with optional payment (PublicSalonController).
@Module({
  imports: [BookingsModule, PaymentsModule, SettingsModule, PaymentsHubModule],
  controllers: [PublicController, PublicSalonController],
  // OnlineDepositService: records online deposits from every source and lets unpaid holds go.
  providers: [ApiKeyGuard, OnlineDepositService],
})
export class PublicModule {}
