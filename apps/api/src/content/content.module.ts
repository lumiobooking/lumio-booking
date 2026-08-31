import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ContentService } from './content.service';
import { ContentAdminService } from './content-admin.service';
import { ContentChatService } from './content-chat.service';
import { ContentController, ContentAdminController } from './content.controller';
import { ContentScheduler } from './content.scheduler';

@Module({
  imports: [SettingsModule],
  controllers: [ContentController, ContentAdminController],
  providers: [ContentService, ContentAdminService, ContentChatService, ContentScheduler],
  exports: [ContentService],
})
export class ContentModule {}
