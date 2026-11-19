import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { StaffInviteController } from './staff-invite.controller';
import { StaffInviteService } from './staff-invite.service';

@Module({
  imports: [AuthModule, PushModule],
  controllers: [StaffInviteController],
  providers: [StaffInviteService],
  exports: [StaffInviteService],
})
export class StaffInviteModule {}
