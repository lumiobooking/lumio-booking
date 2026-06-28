import { SetMetadata } from '@nestjs/common';
import { Capability } from '../capabilities';

export const CAPS_KEY = 'required_caps';

/**
 * Require one of the given feature capabilities. The CapabilitiesGuard reads
 * this. SALON_ADMIN / SUPER_ADMIN always have every capability, so this only
 * restricts STAFF logins (cashier/technician/manager).
 */
export const Caps = (...caps: Capability[]) => SetMetadata(CAPS_KEY, caps);
