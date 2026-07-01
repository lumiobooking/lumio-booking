import { Module } from '@nestjs/common';
import { DisplayService } from './display.service';
import { DisplayController } from './display.controller';
import { PublicDisplayController } from './public-display.controller';

@Module({
  controllers: [DisplayController, PublicDisplayController],
  providers: [DisplayService],
  exports: [DisplayService],
})
export class DisplayModule {}
