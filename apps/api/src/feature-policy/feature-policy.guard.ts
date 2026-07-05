import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { FeaturePolicyService } from './feature-policy.service';
import { FEATURE_KEY_META } from './requires-feature.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/**
 * Route guard: when a route is tagged @RequiresFeature('key'), reject the write
 * with 403 if that feature is platform-managed for the caller's tenant. Super
 * Admin always passes (they manage locked features centrally).
 */
@Injectable()
export class FeaturePolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly svc: FeaturePolicyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_KEY_META, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return true; // the auth guard handles unauthenticated access
    if (user.role === UserRole.SUPER_ADMIN) return true;
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return true;
    await this.svc.assertSalonManaged(tenantId, key); // throws 403 when platform-managed
    return true;
  }
}
