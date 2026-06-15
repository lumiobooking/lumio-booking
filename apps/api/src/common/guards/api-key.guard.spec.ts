import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard, API_KEY_HEADER } from './api-key.guard';
import { hashApiKey } from '../../api-keys/api-key.util';

const VALID_KEY = 'lumio_sk_valid';
const VALID_HASH = hashApiKey(VALID_KEY);

function makeContext(headerKey?: string): { ctx: ExecutionContext; req: any } {
  const req: any = { headers: headerKey ? { [API_KEY_HEADER]: headerKey } : {} };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

/** Prisma mock: returns the seeded key record only for the matching hash. */
function makePrisma(record: any) {
  return {
    apiKey: {
      findUnique: jest.fn(async ({ where }: any) => (where.keyHash === VALID_HASH ? record : null)),
      update: jest.fn(async () => undefined),
    },
  };
}

const activeRecord = {
  id: 'key-1',
  tenantId: 'tenant-a',
  status: 'ACTIVE',
  expiresAt: null,
  tenant: { status: 'ACTIVE' },
};

describe('ApiKeyGuard', () => {
  it('accepts a valid active key and attaches the tenantId', async () => {
    const prisma = makePrisma(activeRecord);
    const guard = new ApiKeyGuard(prisma as any);
    const { ctx, req } = makeContext(VALID_KEY);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.apiTenantId).toBe('tenant-a');
  });

  it('rejects a request with no API key header', async () => {
    const guard = new ApiKeyGuard(makePrisma(activeRecord) as any);
    const { ctx } = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown key', async () => {
    const guard = new ApiKeyGuard(makePrisma(activeRecord) as any);
    const { ctx } = makeContext('lumio_sk_wrong');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked key', async () => {
    const guard = new ApiKeyGuard(makePrisma({ ...activeRecord, status: 'REVOKED' }) as any);
    const { ctx } = makeContext(VALID_KEY);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a key whose salon is suspended', async () => {
    const guard = new ApiKeyGuard(
      makePrisma({ ...activeRecord, tenant: { status: 'SUSPENDED' } }) as any,
    );
    const { ctx } = makeContext(VALID_KEY);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired key', async () => {
    const guard = new ApiKeyGuard(
      makePrisma({ ...activeRecord, expiresAt: new Date(Date.now() - 1000) }) as any,
    );
    const { ctx } = makeContext(VALID_KEY);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
