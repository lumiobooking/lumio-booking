import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule], // PlatformConfigService lives here
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
