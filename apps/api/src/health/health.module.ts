import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { KeepaliveService } from './keepalive.service';

@Module({
  controllers: [HealthController],
  providers: [KeepaliveService],
})
export class HealthModule {}
