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
})
export class WalkinsModule {}
