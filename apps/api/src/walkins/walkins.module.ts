import { Module } from '@nestjs/common';
import { WalkinsController } from './walkins.controller';
import { MyChairController } from './my-chair.controller';
import { WalkinsService } from './walkins.service';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';
import { PushModule } from '../push/push.module';

@Module({
  // Push: a technician's phone buzzes when the dispatcher hands her a customer.
  imports: [CustomersModule, SettingsModule, PushModule],
  controllers: [WalkinsController, MyChairController],
  providers: [WalkinsService],
  // The display module seats a phone check-in through the same turn rotation.
  exports: [WalkinsService],
})
export class WalkinsModule {}
