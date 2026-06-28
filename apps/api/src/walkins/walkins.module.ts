import { Module } from '@nestjs/common';
import { WalkinsController } from './walkins.controller';
import { WalkinsService } from './walkins.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [WalkinsController],
  providers: [WalkinsService],
})
export class WalkinsModule {}
