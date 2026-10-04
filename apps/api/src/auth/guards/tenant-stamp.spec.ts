/**
 * "Tab A is salon A" is kept by the server too: a request stamped for one
 * salon with a token for another is refused before anything is read.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPPORT: 'SUPPORT' },
}));
import { assertTenantStamp, SESSION_TENANT_MISMATCH } from './jwt-auth.guard';

const owner = { userId: 'u', email: 'o@x', role: 'SALON_ADMIN', tenantId: 't1' } as never;
const support = { userId: 's', email: 's@x', role: 'SALON_ADMIN', tenantId: 't1', supportSession: true } as never;
const platform = { userId: 'p', email: 'p@x', role: 'SUPER_ADMIN', tenantId: null } as never;

describe('the tenant stamp', () => {
  it('passes when the page and the token agree, or when there is no stamp', () => {
    expect(() => assertTenantStamp('t1', owner)).not.toThrow();
    expect(() => assertTenantStamp(undefined, owner)).not.toThrow();
    expect(() => assertTenantStamp('', support)).not.toThrow();
  });
  it('refuses a page working in salon A with a token for salon B', () => {
    expect(() => assertTenantStamp('t2', owner)).toThrow(SESSION_TENANT_MISMATCH);
    expect(() => assertTenantStamp('t2', support)).toThrow(SESSION_TENANT_MISMATCH);
    expect(() => assertTenantStamp(['t2'], support)).toThrow(SESSION_TENANT_MISMATCH);
  });
  it('the platform team carries no salon and is never stamped against one', () => {
    expect(() => assertTenantStamp('t2', platform)).not.toThrow();
  });
});
