import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SettingsModule } from '../settings/settings.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [SettingsModule, LoyaltyModule], // tax/currency settings + loyalty points
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
