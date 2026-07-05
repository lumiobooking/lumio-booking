import { Global, Module } from '@nestjs/common';
import { FeaturePolicyService } from './feature-policy.service';
import { FeaturePolicyGuard } from './feature-policy.guard';
import { FeaturePolicyController, FeaturePolicyAdminController } from './feature-policy.controller';

/**
 * Global so any module can inject FeaturePolicyService / apply FeaturePolicyGuard
 * (via @UseGuards + @RequiresFeature) without re-importing.
 */
@Global()
@Module({
  providers: [FeaturePolicyService, FeaturePolicyGuard],
  controllers: [FeaturePolicyController, FeaturePolicyAdminController],
  exports: [FeaturePolicyService, FeaturePolicyGuard],
})
export class FeaturePolicyModule {}
