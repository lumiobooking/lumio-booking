import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY_META = 'requiresFeature';

/**
 * Mark a route so FeaturePolicyGuard blocks salon writes when the feature is
 * platform-managed. Super Admin and Lumio support sessions always pass.
 *
 * Several keys mean ANY of them: connecting Facebook lives on both the
 * channels screen and the Messenger bot screen, so a salon handed either
 * screen may use it.
 */
export const RequiresFeature = (...keys: string[]) => SetMetadata(FEATURE_KEY_META, keys);
