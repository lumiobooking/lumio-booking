import { Module } from '@nestjs/common';
import { PaymentsHubModule } from '../payments-hub/payments-hub.module';
import { SquarePosController } from './square-pos.controller';
import { SquarePosService } from './square-pos.service';

/** Square POS sync (square-pos.logic.ts). Inert until a salon turns it on. */
@Module({
  imports: [PaymentsHubModule],
  controllers: [SquarePosController],
  providers: [SquarePosService],
})
export class SquarePosModule {}
