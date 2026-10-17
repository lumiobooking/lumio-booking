import { Module } from '@nestjs/common';
import { DisplayService } from './display.service';
import { DisplayController } from './display.controller';
import { PublicDisplayController } from './public-display.controller';
import { CustomersModule } from '../customers/customers.module';
import { WalkinsModule } from '../walkins/walkins.module';
import { ClientFormsModule } from '../client-forms/client-forms.module';

@Module({
  imports: [CustomersModule, WalkinsModule, ClientFormsModule],
  controllers: [DisplayController, PublicDisplayController],
  providers: [DisplayService],
  exports: [DisplayService],
})
export class DisplayModule {}
