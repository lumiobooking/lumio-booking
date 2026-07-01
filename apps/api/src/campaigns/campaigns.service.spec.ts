import { UserRole } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { CAMPAIGN_SETTINGS_KEY, campaignRelatedType } from './campaigns.constants';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// --- In-memory fake of the Prisma surface the settings/stats paths use. ---
function makePrismaFake(opts?: { notifications?: { tenantId: string; relatedType: string }[] }) {
  const settings = new Map<string, unknown>(); // key = `${tenantId}::${key}`
  const notifications = opts?.notifications ?? [];
  return {
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = `${where.tenantId_key.tenantId}::${where.tenantId_key.key}`;
        return settings.has(k) ? { value: settings.get(k) } : null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = `${where.tenantId_key.tenantId}::${where.tenantId_key.key}`;
        settings.set(k, (settings.has(k) ? update.value : create.value));
        return { value: settings.get(k) };
      }),
      findMany: jest.fn(async () => []),
    },
    notification: {
      groupBy: jest.fn(async ({ where }: any) =>
        // Emulate groupBy by relatedType, scoped to the requested tenantId.
        Array.from(
          notifications
            .filter((n) => n.tenantId === where.tenantId && where.relatedType.in.includes(n.relatedType))
            .reduce((m, n) => m.set(n.relatedType, (m.get(n.relatedType) ?? 0) + 1), new Map<string, number>())
            .entries(),
        ).map(([relatedType, count]) => ({ relatedType, _count: { _all: count } })),
      ),
    },
    _settings: settings,
  };
}

const notificationsFake = { send: jest.fn(async () => undefined) };
const settingsFake = { getNotificationSettings: jest.fn(async () => ({})) };
// Referral is OFF here, so campaign messages carry no referral CTA in these tests.
const referralFake = { getForTenant: jest.fn(async () => ({ enabled: false, referrerPoints: 0, refereePoints: 0, message: '' })), ensureLinkForCustomer: jest.fn(async () => null) };

const salonA: AuthenticatedUser = { userId: 'u-a', email: 'a@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };
const salonB: AuthenticatedUser = { userId: 'u-b', email: 'b@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-b' };

describe('CampaignsService tenant isolation', () => {
  it('updateSettings persists under the caller tenant only', async () => {
    const prisma = makePrismaFake();
    const svc = new CampaignsService(prisma as any, notificationsFake as any, settingsFake as any, referralFake as any);

    await svc.updateSettings(salonA, { winBack: { enabled: true } });

    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_key: { tenantId: 'tenant-a', key: CAMPAIGN_SETTINGS_KEY } } }),
    );
    // Tenant A sees its change; tenant B still gets the (disabled) defaults — no leak.
    expect((await svc.getSettings(salonA)).winBack.enabled).toBe(true);
    expect((await svc.getSettings(salonB)).winBack.enabled).toBe(false);
  });

  it('getSettings merges stored values over defaults', async () => {
    const prisma = makePrismaFake();
    const svc = new CampaignsService(prisma as any, notificationsFake as any, settingsFake as any, referralFake as any);

    const s = await svc.getSettings(salonA);
    expect(s.sendHour).toBe(10); // default
    expect(s.birthday.enabled).toBe(false);
    expect(s.winBack.daysSince).toBeGreaterThan(0);
  });

  it('getStats counts only the caller tenant notifications', async () => {
    const prisma = makePrismaFake({
      notifications: [
        { tenantId: 'tenant-a', relatedType: campaignRelatedType('winBack') },
        { tenantId: 'tenant-a', relatedType: campaignRelatedType('winBack') },
        { tenantId: 'tenant-a', relatedType: campaignRelatedType('birthday') },
        { tenantId: 'tenant-b', relatedType: campaignRelatedType('winBack') }, // other tenant — must be ignored
      ],
    });
    const svc = new CampaignsService(prisma as any, notificationsFake as any, settingsFake as any, referralFake as any);

    const stats = await svc.getStats(salonA);

    expect(stats.winBack).toBe(2);
    expect(stats.birthday).toBe(1);
    expect(stats.reactivation).toBe(0);
    expect(prisma.notification.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });

  it('clamps sendHour into 0–23 on save', async () => {
    const prisma = makePrismaFake();
    const svc = new CampaignsService(prisma as any, notificationsFake as any, settingsFake as any, referralFake as any);

    const saved = await svc.updateSettings(salonA, { sendHour: 99 });
    expect(saved.sendHour).toBe(23);
  });
});
