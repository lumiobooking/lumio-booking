import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { HeldBillsController } from './held-bills.controller';
import { HeldBillsService } from './held-bills.service';
import { CashShiftsController } from './cash-shifts.controller';
import { CashShiftsService } from './cash-shifts.service';
import { SettingsModule } from '../settings/settings.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { WalkinsModule } from '../walkins/walkins.module';
import { FeedbackModule } from '../feedback/feedback.module';

@Module({
  // + walk-ins: a checkout closes the ticket, which opens a chair for the queue
  imports: [MaintenanceModule, SettingsModule, LoyaltyModule, GiftCardsModule, WalkinsModule, FeedbackModule],
  controllers: [PosController, HeldBillsController, CashShiftsController],
  providers: [PosService, HeldBillsService, CashShiftsService],
  exports: [PosService, CashShiftsService],
})
export class PosModule {}
