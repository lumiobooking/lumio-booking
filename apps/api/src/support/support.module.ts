import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
