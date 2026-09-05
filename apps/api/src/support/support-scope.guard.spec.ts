import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SupportScopeGuard } from './support-scope.guard';

function ctx(user: unknown, method = 'GET', originalUrl = '/customers'): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, method, originalUrl }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const guard = new SupportScopeGuard();

describe('the door on a Lumio setup session', () => {
  it('is not in the way of anybody else', () => {
    // The whole reason this is its own guard rather than more @Caps(): a rule
    // about Lumio's own staff must not change what a paying salon's users can
    // do. Every non-support request leaves through this line untouched.
    expect(guard.canActivate(ctx({ role: UserRole.SALON_ADMIN, tenantId: 't1' }))).toBe(true);
    expect(guard.canActivate(ctx({ role: UserRole.STAFF, tenantId: 't1' }, 'POST', '/payments'))).toBe(true);
    expect(guard.canActivate(ctx({ role: UserRole.SUPER_ADMIN, tenantId: null }, 'POST', '/customers'))).toBe(true);
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('refuses the customer list to a content account', () => {
    const user = { role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true, supportLevel: 'content' };
    expect(() => guard.canActivate(ctx(user, 'GET', '/customers?page=1'))).toThrow(ForbiddenException);
  });

  it('refuses the takings to a setup account', () => {
    const user = { role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true, supportLevel: 'setup' };
    expect(() => guard.canActivate(ctx(user, 'GET', '/overview/dashboard?from=2026-01-01'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(user, 'GET', '/staff/performance?from=2026-01-01'))).toThrow(ForbiddenException);
  });

  it('lets the setup account do the setup', () => {
    const user = { role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true, supportLevel: 'setup' };
    expect(guard.canActivate(ctx(user, 'POST', '/services'))).toBe(true);
    expect(guard.canActivate(ctx(user, 'PATCH', '/settings'))).toBe(true);
    expect(guard.canActivate(ctx(user, 'GET', '/staff'))).toBe(true);
  });

  it('a session with no level stored is a narrow one, not a wide one', () => {
    // Tokens minted before the level existed carry nothing. Reading that as
    // "no limits" would leave every old session exactly as it was.
    const user = { role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true };
    expect(() => guard.canActivate(ctx(user, 'GET', '/customers'))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(user, 'POST', '/content/posts'))).toBe(true);
  });

  it('says what to do about it, in the language the employee reads', () => {
    const user = { role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true, supportLevel: 'content' };
    try {
      guard.canActivate(ctx(user, 'GET', '/customers'));
      throw new Error('should have refused');
    } catch (e) {
      expect((e as ForbiddenException).message).toContain('Nhắn quản lý Lumio');
    }
  });
});
