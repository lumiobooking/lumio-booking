import { Module } from '@nestjs/common';
import { WalkinsController } from './walkins.controller';
import { WalkinsService } from './walkins.service';

@Module({
  controllers: [WalkinsController],
  providers: [WalkinsService],
})
export class WalkinsModule {}
