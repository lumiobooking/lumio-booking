import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsScheduler } from './campaigns.scheduler';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsScheduler],
  exports: [CampaignsService],
})
export class CampaignsModule {}
