import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY_META = 'requiresFeature';

/** Mark a route so FeaturePolicyGuard blocks salon writes when the feature is
 *  platform-managed. Super Admin always bypasses. */
export const RequiresFeature = (key: string) => SetMetadata(FEATURE_KEY_META, key);
