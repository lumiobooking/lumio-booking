import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { GoogleDriveService } from './google-drive.service';
import { GoogleDriveController } from './google-drive.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule], // PlatformConfigService lives here
  controllers: [UploadsController, GoogleDriveController],
  providers: [UploadsService, GoogleDriveService],
  // ContentModule's publisher deletes the files it uploaded once the posts have
  // been live long enough; that needs the same FTP config this service holds.
  exports: [UploadsService, GoogleDriveService],
})
export class UploadsModule {}
