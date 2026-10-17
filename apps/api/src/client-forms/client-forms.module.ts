import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClientFormsController, PublicClientFormsController } from './client-forms.controller';
import { ClientFormsService } from './client-forms.service';
import { ClientFormsDispatcher } from './client-forms.dispatcher';

/** Massage / spa paperwork: intake, consent and SOAP notes (see form-templates.ts). */
@Module({
  imports: [SettingsModule, NotificationsModule],
  controllers: [PublicClientFormsController, ClientFormsController],
  providers: [ClientFormsService, ClientFormsDispatcher],
  exports: [ClientFormsService], // the check-in iPad offers "sign your forms"
})
export class ClientFormsModule {}
