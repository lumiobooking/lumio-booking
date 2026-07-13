import { Module } from '@nestjs/common';
import { EmailCampaignsService } from './email-campaigns.service';
import { EmailAutomationScheduler } from './email-automation.scheduler';
import { EmailCampaignsController, AdminEmailCampaignsController, UnsubscribeController, InboundReplyController } from './email-campaigns.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { BillingModule } from '../billing/billing.module';
import { FeaturePolicyModule } from '../feature-policy/feature-policy.module';

@Module({
  imports: [NotificationsModule, SettingsModule, BillingModule, FeaturePolicyModule],
  controllers: [EmailCampaignsController, AdminEmailCampaignsController, UnsubscribeController, InboundReplyController],
  providers: [EmailCampaignsService, EmailAutomationScheduler],
})
export class EmailCampaignsModule {}
