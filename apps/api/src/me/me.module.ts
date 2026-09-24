import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  controllers: [MeController],
})
export class MeModule {}
