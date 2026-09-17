import { Module } from '@nestjs/common';
import { DisplayService } from './display.service';
import { DisplayController } from './display.controller';
import { PublicDisplayController } from './public-display.controller';
import { CustomersModule } from '../customers/customers.module';
import { WalkinsModule } from '../walkins/walkins.module';

@Module({
  imports: [CustomersModule, WalkinsModule],
  controllers: [DisplayController, PublicDisplayController],
  providers: [DisplayService],
  exports: [DisplayService],
})
export class DisplayModule {}
