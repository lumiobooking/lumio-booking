import { Module } from '@nestjs/common';
import { WalkinsController } from './walkins.controller';
import { MyChairController } from './my-chair.controller';
import { WalkinsService } from './walkins.service';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CustomersModule, SettingsModule],
  controllers: [WalkinsController, MyChairController],
  providers: [WalkinsService],
  // The display module seats a phone check-in through the same turn rotation.
  exports: [WalkinsService],
})
export class WalkinsModule {}
