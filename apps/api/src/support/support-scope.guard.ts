import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { levelOf, supportMayCall } from './support-scope';

/**
 * The door on a Lumio setup employee's session.
 *
 * WHY A SEPARATE GUARD RATHER THAN MORE @Caps()
 *
 * The obvious move was to hang `@Caps('payroll')` on the payroll routes and
 * let the existing machinery do it. That would also have taken payroll away
 * from every RECEPTIONIST at every live salon, today, in the middle of a
 * working day — a rule about Lumio's own staff is not worth a change of
 * behaviour for people paying for the product.
 *
 * So this guard answers only for tokens that carry `supportSession: true`.
 * Every other request in the system leaves through the first line unchanged,
 * which is also what makes the change safe to deploy on a Friday.
 *
 * WHAT IT REFUSES
 *
 * The rule itself lives in `support-scope.ts` and is tested there. In one
 * sentence: money and client data are refused outright; anything else outside
 * the employee's scope can be read but not written.
 *
 * "Scope" is the level's preset unless the employee carries a hand-picked list,
 * in which case the list is the whole answer. Both ride on the token.
 */
@Injectable()
export class SupportScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req?.user as AuthenticatedUser | undefined;
    if (!user?.supportSession) return true;

    // `originalUrl` is what the browser asked for, before Nest rewrote
    // anything; `url` is the fallback for the test harness.
    const path = String(req?.originalUrl ?? req?.url ?? '');
    // The preset AND the employee's own list, both frozen into the token at
    // enter-salon time. Passing the list here rather than re-reading the row is
    // what keeps the session honest: changing somebody's ticks takes effect on
    // their next entry, and the token that did the work still says what it was
    // allowed to do.
    if (supportMayCall(levelOf(user.supportLevel), req?.method, path, user.supportCaps)) return true;

    throw new ForbiddenException(
      'Tài khoản setup của bạn không mở mục này. Nhắn quản lý Lumio nếu bạn cần nó cho công việc.',
    );
  }
}
