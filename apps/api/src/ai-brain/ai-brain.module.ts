import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PushModule } from '../push/push.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AiBrainController } from './ai-brain.controller';
import { AiBrainService } from './ai-brain.service';
import { AiInstructionsService } from './instructions.service';

/**
 * The salon's AI brain (brain-settings.ts). Global, so the hotline, Messenger,
 * Zalo and the website chat inject it without each importing the module.
 */
@Global()
@Module({
  imports: [SettingsModule, PushModule, BookingsModule],
  controllers: [AiBrainController],
  providers: [AiBrainService, AiInstructionsService],
  exports: [AiBrainService, AiInstructionsService],
})
export class AiBrainModule {}
