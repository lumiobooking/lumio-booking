import { Module } from '@nestjs/common';
import { WalkinsController } from './walkins.controller';
import { WalkinsService } from './walkins.service';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CustomersModule, SettingsModule],
  controllers: [WalkinsController],
  providers: [WalkinsService],
})
export class WalkinsModule {}
