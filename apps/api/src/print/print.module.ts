import { Module } from '@nestjs/common';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { PrintAgentController, PrintDevicesController } from './print-devices.controller';
import { PrintDevicesService } from './print-devices.service';

/** Receipt print queue + reception-desk agent endpoints. */
@Module({
  controllers: [PrintController, PrintDevicesController, PrintAgentController],
  providers: [PrintService, PrintDevicesService, ApiKeyGuard],
})
export class PrintModule {}
