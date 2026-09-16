import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';

/**
 * Global on purpose: the meter is injected by Messenger, Content, Google
 * Reviews and whatever calls a model next. Making each of those import a
 * module would mean a wiring change every time a new call site appears —
 * exactly the friction that ends with a call site nobody counted.
 */
@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
