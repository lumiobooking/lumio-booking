import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Capability, capabilitiesFor } from '../capabilities';
import { CAPS_KEY } from '../decorators/caps.decorator';
import { AuthenticatedUser } from '../../common/tenant/tenant-context';

/**
 * Feature-permission gate. Runs after JwtAuthGuard + RolesGuard. If a route has
 * no @Caps() it passes (so existing endpoints are unchanged). When @Caps() is
 * present, the user must hold at least one of the listed capabilities. Owners /
 * super-admins always hold every capability, so this only restricts STAFF.
 */
@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[]>(CAPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    const caps = capabilitiesFor(user.role, user.staffRole);
    if (!required.some((c) => caps.includes(c))) {
      throw new ForbiddenException('You do not have permission for this feature');
    }
    return true;
  }
}
