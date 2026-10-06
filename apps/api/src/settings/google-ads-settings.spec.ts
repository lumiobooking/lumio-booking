import { SettingsService } from './settings.service';

/**
 * A salon pastes its Google Ads conversion ID + label once; the booking page
 * then reports every booking to Google Ads by itself. The two values are
 * public front-end IDs, but they are still checked so a typo can never put
 * arbitrary text into the page's script, and they belong to ONE salon only.
 */
function makeService() {
  const rows: Record<string, unknown> = {};
  const prisma: any = {
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const v = rows[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`];
        return v ? { value: v } : null;
      }),
      upsert: jest.fn(async ({ where, create }: any) => {
        rows[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`] = create.value;
        return create;
      }),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const svc = new SettingsService(prisma, audit);
  (svc as any).get = jest.fn(async () => ({}));
  return { svc, audit };
}
const admin = (tenantId: string) => ({ userId: `u-${tenantId}`, role: 'SALON_ADMIN', tenantId }) as any;

describe('Google Ads conversion settings', () => {
  it('saves a valid ID and label, uppercasing the ID', async () => {
    const { svc, audit } = makeService();
    await svc.updateAnalytics(admin('A'), { adsId: ' aw-18473564020 ', adsLabel: 'AbC-12_xY' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ adsId: 'AW-18473564020', adsLabel: 'AbC-12_xY' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'settings.analytics_updated' }));
  });

  it('accepts the whole "AW-…/label" send_to pasted into the ID box', async () => {
    const { svc } = makeService();
    await svc.updateAnalytics(admin('A'), { adsId: 'AW-18473564020/AbCdEf_12' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ adsId: 'AW-18473564020', adsLabel: 'AbCdEf_12' });
  });

  it('keeps the previous value when the new one is malformed (no script injection)', async () => {
    const { svc } = makeService();
    await svc.updateAnalytics(admin('A'), { adsId: 'AW-18473564020', adsLabel: 'GoodLabel1' });
    await svc.updateAnalytics(admin('A'), { adsId: "AW-1');alert(1)//", adsLabel: '<script>' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ adsId: 'AW-18473564020', adsLabel: 'GoodLabel1' });
    await svc.updateAnalytics(admin('A'), { adsId: 'G-ABCDEF123' });
    expect((await svc.getAnalyticsSettings('A')).adsId).toBe('AW-18473564020');
  });

  it('can be cleared, and leaves GA4/GTM untouched', async () => {
    const { svc } = makeService();
    await svc.updateAnalytics(admin('A'), { ga4Id: 'G-ABCDEF123', adsId: 'AW-18473564020', adsLabel: 'GoodLabel1' });
    await svc.updateAnalytics(admin('A'), { adsId: '', adsLabel: '' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ ga4Id: 'G-ABCDEF123', adsId: '', adsLabel: '' });
  });

  it('salons saved before this existed read back empty Ads fields', async () => {
    const { svc } = makeService();
    await svc.updateAnalytics(admin('A'), { ga4Id: 'G-ABCDEF123' });
    expect(await svc.getAnalyticsSettings('B')).toMatchObject({ adsId: '', adsLabel: '' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ adsId: '', adsLabel: '' });
  });

  it('one salon’s Ads conversion never shows up on another salon', async () => {
    const { svc } = makeService();
    await svc.updateAnalytics(admin('A'), { adsId: 'AW-111111111', adsLabel: 'LabelA1' });
    await svc.updateAnalytics(admin('B'), { adsId: 'AW-222222222', adsLabel: 'LabelB2' });
    expect(await svc.getAnalyticsSettings('A')).toMatchObject({ adsId: 'AW-111111111', adsLabel: 'LabelA1' });
    expect(await svc.getAnalyticsSettings('B')).toMatchObject({ adsId: 'AW-222222222', adsLabel: 'LabelB2' });
  });
});
