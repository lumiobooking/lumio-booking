import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  imports: [JwtModule.register({}), MarketingModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
