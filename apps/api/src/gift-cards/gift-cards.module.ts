import { Module } from '@nestjs/common';
import { GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule], // currency for the sale's revenue mirror
  controllers: [GiftCardsController],
  providers: [GiftCardsService],
  exports: [GiftCardsService], // PosService uses it to redeem at checkout
})
export class GiftCardsModule {}
