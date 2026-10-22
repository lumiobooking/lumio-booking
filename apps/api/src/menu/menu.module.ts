import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [SettingsModule],
  controllers: [MenuController],
  providers: [MenuService],
})
export class MenuModule {}
