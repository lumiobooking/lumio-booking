import { Module } from '@nestjs/common';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

/** Receipt print queue + reception-desk agent endpoints. */
@Module({
  controllers: [PrintController],
  providers: [PrintService, ApiKeyGuard],
})
export class PrintModule {}
