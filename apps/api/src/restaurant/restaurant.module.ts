import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { SettingsModule } from '../settings/settings.module';
import { PushModule } from '../push/push.module';
import { RestaurantController } from './restaurant.controller';
import { PublicTableController } from './public-table.controller';
import { RestaurantService } from './restaurant.service';

@Module({
  imports: [PosModule, SettingsModule, PushModule],
  controllers: [RestaurantController, PublicTableController],
  providers: [RestaurantService],
})
export class RestaurantModule {}
