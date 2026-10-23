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
    const meta = this.reflector.getAllAndOverride<string | string[]>(FEATURE_KEY_META, [ctx.getHandler(), ctx.getClass()]);
    const keys = (Array.isArray(meta) ? meta : meta ? [meta] : []).filter(Boolean);
    if (!keys.length) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return true; // the auth guard handles unauthenticated access
    if (user.role === UserRole.SUPER_ADMIN) return true;
    // Lumio SUPPORT setup session: platform-managed screens are exactly what
    // they are here to configure. The token is salon-scoped, so this loosens
    // WHICH screens — never WHOSE data.
    if (user.supportSession) return true;
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return true;
    await this.svc.assertAnySalonManaged(tenantId, keys); // throws 403 when every key is platform-managed
    return true;
  }
}
