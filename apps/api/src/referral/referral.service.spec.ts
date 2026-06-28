import { UserRole } from '@prisma/client';
import { ReferralService } from './referral.service';
import { REFERRAL_SETTINGS_KEY } from './referral.constants';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

type Cust = { id: string; tenantId: string; referralCode?: string | null; referredById?: string | null; referralRewardedAt?: Date | null };

function makePrismaFake(customers: Cust[] = []) {
  const settings = new Map<string, unknown>();
  return {
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = `${where.tenantId_key.tenantId}::${where.tenantId_key.key}`;
        return settings.has(k) ? { value: settings.get(k) } : null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = `${where.tenantId_key.tenantId}::${where.tenantId_key.key}`;
        settings.set(k, settings.has(k) ? update.value : create.value);
        return { value: settings.get(k) };
      }),
    },
    customer: {
      findFirst: jest.fn(async ({ where }: any) =>
        customers.find(
          (c) =>
            (where.id === undefined || c.id === where.id) &&
            (where.tenantId === undefined || c.tenantId === where.tenantId) &&
            (where.referralCode === undefined || c.referralCode === where.referralCode),
        ) ?? null,
      ),
      count: jest.fn(async ({ where }: any) =>
        customers.filter(
          (c) =>
            c.tenantId === where.tenantId &&
            (where.referredById === undefined || c.referredById != null) &&
            (where.referralRewardedAt === undefined || c.referralRewardedAt != null),
        ).length,
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    tenant: { findUnique: jest.fn(async () => ({ slug: 'salon-a' })) },
  };
}

const loyaltyFake = { credit: jest.fn(async () => 0) };
const salonA: AuthenticatedUser = { userId: 'u-a', email: 'a@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };
const salonB: AuthenticatedUser = { userId: 'u-b', email: 'b@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-b' };

describe('ReferralService tenant isolation', () => {
  it('updateSettings persists under the caller tenant; other tenant unaffected', async () => {
    const prisma = makePrismaFake();
    const svc = new ReferralService(prisma as any, loyaltyFake as any);

    await svc.updateSettings(salonA, { enabled: true, referrerPoints: 200 });

    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_key: { tenantId: 'tenant-a', key: REFERRAL_SETTINGS_KEY } } }),
    );
    expect((await svc.getSettings(salonA)).enabled).toBe(true);
    expect((await svc.getSettings(salonA)).referrerPoints).toBe(200);
    expect((await svc.getSettings(salonB)).enabled).toBe(false); // default — no leak
  });

  it('resolveReferrerId returns null when off, and is tenant-scoped when on', async () => {
    const prisma = makePrismaFake([
      { id: 'cust-a', tenantId: 'tenant-a', referralCode: 'JANE7K2P' },
      { id: 'cust-b', tenantId: 'tenant-b', referralCode: 'OTHER123' },
    ]);
    const svc = new ReferralService(prisma as any, loyaltyFake as any);

    // Program off by default → no attribution.
    expect(await svc.resolveReferrerId(prisma as any, 'tenant-a', 'JANE7K2P')).toBeNull();

    await svc.updateSettings(salonA, { enabled: true });
    // On → resolves within tenant A.
    expect(await svc.resolveReferrerId(prisma as any, 'tenant-a', 'JANE7K2P')).toBe('cust-a');
    // Another tenant's code is never resolvable from tenant A.
    expect(await svc.resolveReferrerId(prisma as any, 'tenant-a', 'OTHER123')).toBeNull();
  });

  it('getStats counts only the caller tenant', async () => {
    const prisma = makePrismaFake([
      { id: 'c1', tenantId: 'tenant-a', referredById: 'r1', referralRewardedAt: new Date() },
      { id: 'c2', tenantId: 'tenant-a', referredById: 'r1', referralRewardedAt: null },
      { id: 'c3', tenantId: 'tenant-b', referredById: 'r9', referralRewardedAt: new Date() }, // other tenant
    ]);
    const svc = new ReferralService(prisma as any, loyaltyFake as any);

    const stats = await svc.getStats(salonA);
    expect(stats.totalReferred).toBe(2);
    expect(stats.rewarded).toBe(1);
  });

  it('rewardOnCompletion is a no-op when the program is off', async () => {
    const prisma = makePrismaFake([{ id: 'c1', tenantId: 'tenant-a', referredById: 'r1', referralRewardedAt: null }]);
    const svc = new ReferralService(prisma as any, loyaltyFake as any);

    await svc.rewardOnCompletion('tenant-a', 'c1', 'appt-1');
    expect(loyaltyFake.credit).not.toHaveBeenCalled();
  });
});
