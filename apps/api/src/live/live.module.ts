import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';

/** The salon-wide nudge stream (live.controller.ts). */
@Module({ controllers: [LiveController] })
export class LiveModule {}
