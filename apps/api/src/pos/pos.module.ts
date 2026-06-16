import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule], // for per-salon tax + currency settings
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
