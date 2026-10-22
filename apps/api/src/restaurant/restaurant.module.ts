import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { SettingsModule } from '../settings/settings.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

@Module({
  imports: [PosModule, SettingsModule],
  controllers: [RestaurantController],
  providers: [RestaurantService],
})
export class RestaurantModule {}
