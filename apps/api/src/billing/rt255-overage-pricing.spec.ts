import { BillingService } from './billing.service';

/**
 * rt255 — the month-end invoice prices SMS / AI Hotline overage exactly as the
 * Usage screen does: the salon's own rate, else the platform default. Before,
 * a salon with no AI Hotline line (almost all) was invoiced nothing for SMS.
 */
export function svc(o: { platform?: Record<string, string>; line?: Partial<{ includedSms: number; overageCentsPerSms: number; includedMinutes: number; overageCentsPerMin: number }>; smsSent: number; segments?: number; minutes?: number; planSms: number; planName?: string; market?: string; hotline?: { enabled: boolean; monthlyCents: number } }) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ market: o.market ?? 'US', plan: { name: o.planName ?? 'Starter', currency: 'USD', maxSmsPerMonth: o.planSms } })) },
    platformConfig: { findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) => Object.entries(o.platform ?? {}).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))) },
    voiceLine: { findUnique: jest.fn(async () => o.hotline ?? null) },
  };
  const platform = { get: jest.fn(async (k: string) => (o.platform ?? {})[k]) };
  const voice = {
    usageForMonth: jest.fn(async () => ({
      smsSent: o.smsSent, smsSegments: o.segments ?? o.smsSent, aiMinutes: o.minutes ?? 0,
      includedSms: o.line?.includedSms ?? 0, overageCentsPerSms: o.line?.overageCentsPerSms ?? 0,
      includedMinutes: o.line?.includedMinutes ?? 0, overageCentsPerMin: o.line?.overageCentsPerMin ?? 0,
    })),
  };
  const s = new BillingService(prisma as never, { log: jest.fn() } as never, {} as never, { get: () => undefined } as never, {} as never, {} as never, platform as never, voice as never);
  return s;
}

describe('rt255 overage priced like the Usage screen', () => {
  const month = new Date(Date.UTC(2026, 10, 1));

  it('no Hotline line: SMS over the plan is billed at the platform default', async () => {
    const r = await svc({ platform: { sms_overage_cents: '3' }, smsSent: 615, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.sms).toMatchObject({ included: 100, used: 615, over: 515, centsPer: 3, overageCents: 1545, source: 'platform' });
  });

  it('no price anywhere: nothing billed, and it says "unset" (never "free")', async () => {
    const r = await svc({ smsSent: 615, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.sms).toMatchObject({ over: 515, overageCents: 0, source: 'unset' });
  });

  it("a salon's own agreed price wins over the default", async () => {
    const r = await svc({ platform: { sms_overage_cents: '3' }, line: { overageCentsPerSms: 2 }, smsSent: 200, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.sms).toMatchObject({ over: 100, centsPer: 2, overageCents: 200, source: 'tenant' });
  });

  it('AI Hotline minutes over the included bucket use the platform per-minute default', async () => {
    const r = await svc({ platform: { hotline_overage_cents_per_min: '25' }, line: { includedMinutes: 300 }, minutes: 340, smsSent: 0, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.minutes).toMatchObject({ included: 300, used: 340, over: 40, centsPer: 25, overageCents: 1000 });
  });

  it('no included minutes = unlimited: nothing over, nothing billed', async () => {
    const r = await svc({ platform: { hotline_overage_cents_per_min: '25' }, minutes: 340, smsSent: 0, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.minutes).toMatchObject({ over: 0, overageCents: 0 });
  });
});

describe('rt256 parts, markets, Premium minutes, start month', () => {
  const month = new Date(Date.UTC(2026, 11, 1)); // December

  it('SMS counted in parts: 120 texts of 2 parts on a 100-part plan = 140 over', async () => {
    const r = await svc({ platform: { sms_overage_cents: '4' }, smsSent: 120, segments: 240, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.sms).toMatchObject({ used: 240, messages: 120, over: 140, centsPer: 4, overageCents: 560 });
  });

  it('an Australian salon pays the Australian price', async () => {
    const r = await svc({ platform: { sms_overage_cents: '4', sms_overage_cents_au: '10' }, market: 'AU', smsSent: 150, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.sms).toMatchObject({ over: 50, centsPer: 10, overageCents: 500 });
  });

  it('months before the start month are never charged, not even a salon\'s own price or the Hotline fee', async () => {
    const nov = new Date(Date.UTC(2026, 10, 1));
    const r = await svc({ platform: { sms_overage_cents: '4', usage_rates_from: '2026-12' }, line: { overageCentsPerSms: 5 }, hotline: { enabled: true, monthlyCents: 4900 }, smsSent: 615, planSms: 100 }).smsAndMinutesOverageForMonth('t1', nov);
    expect(r.sms.overageCents).toBe(0);
    expect(r.hotlineMonthlyCents).toBe(0);
    const dec = await svc({ platform: { sms_overage_cents: '4', usage_rates_from: '2026-12' }, hotline: { enabled: true, monthlyCents: 4900 }, smsSent: 615, planSms: 100 }).smsAndMinutesOverageForMonth('t1', month);
    expect(dec.sms.overageCents).toBe(515 * 4);
    expect(dec.hotlineMonthlyCents).toBe(4900);
  });

  it('Premium with a live Hotline includes 300 minutes; over that is charged', async () => {
    const r = await svc({ platform: { hotline_overage_cents_per_min: '25' }, planName: 'Premium', hotline: { enabled: true, monthlyCents: 0 }, minutes: 320, smsSent: 0, planSms: 1500 }).smsAndMinutesOverageForMonth('t1', month);
    expect(r.minutes).toMatchObject({ included: 300, over: 20, overageCents: 500 });
  });
});
