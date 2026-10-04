import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../../common/tenant/tenant-context';

/** The refusal the browser reloads on: its page and its token disagree about the salon. */
export const SESSION_TENANT_MISMATCH = 'SESSION_TENANT_MISMATCH';

/**
 * Global authentication guard. Validates the JWT on every request unless the
 * route is marked @Public(). Registered as an APP_GUARD in AuthModule.
 *
 * It also honours the browser's tenant stamp. Every request from the web app
 * says which salon the page believes it is working in (X-Tenant-Id, the
 * tenant of the session that tab restored). A token for another salon is
 * refused outright — nothing is read or written for the wrong salon — and
 * the page reloads into the session it really holds. Lumio Support staff set
 * up several salons in several tabs; this is what makes "tab A is salon A"
 * a promise the server keeps, not only the browser.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const r = super.canActivate(context);
    const ok = typeof r === 'boolean' ? r : isObservable(r) ? await lastValueFrom(r) : await r;
    if (!ok) return false;
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }>();
    assertTenantStamp(req.headers?.['x-tenant-id'], req.user);
    return true;
  }
}

/**
 * The stamp must name the token's own salon. No stamp (an old page, a script,
 * a webhook) is fine; the platform team carries no salon and is never stamped
 * against one. Pure, so the rule is tested on its own.
 */
export function assertTenantStamp(stamp: string | string[] | undefined, user: AuthenticatedUser | undefined): void {
  const s = (Array.isArray(stamp) ? stamp[0] : stamp ?? '').trim();
  if (!s || !user || user.role === 'SUPER_ADMIN' || !user.tenantId) return;
  if (s !== user.tenantId) throw new ForbiddenException(SESSION_TENANT_MISMATCH);
}
