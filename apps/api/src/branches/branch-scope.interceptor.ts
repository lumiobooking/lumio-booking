import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { BranchesService } from './branches.service';

/**
 * Re-scopes a request to a selected branch for multi-branch (chain) users.
 *
 * Runs after the JWT guard. If the request carries an `X-Branch-Id` header that
 * differs from the user's home tenant, it validates the user is allowed that
 * branch and overwrites `user.tenantId` with it — so every existing tenant-scoped
 * query (which reads `resolveTenantScope(user)`) automatically targets the chosen
 * branch. Single-salon users send no header and are completely unaffected.
 */
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  constructor(private readonly branches: BranchesService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    const user = req?.user as AuthenticatedUser | undefined;
    const raw = req?.headers?.['x-branch-id'];
    const branchId = Array.isArray(raw) ? raw[0] : raw;

    if (
      user &&
      user.role !== UserRole.SUPER_ADMIN &&
      typeof branchId === 'string' &&
      branchId.length > 0 &&
      branchId !== user.tenantId
    ) {
      const ok = await this.branches.canAccess(user, branchId);
      if (!ok) throw new ForbiddenException('You do not have access to that branch');
      user.homeTenantId = user.tenantId; // remember the real home before re-scoping
      user.tenantId = branchId;
    }
    return next.handle();
  }
}
