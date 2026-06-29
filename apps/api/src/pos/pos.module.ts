import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SettingsModule } from '../settings/settings.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';

@Module({
  imports: [SettingsModule, LoyaltyModule, GiftCardsModule], // tax/currency + loyalty + gift cards
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
