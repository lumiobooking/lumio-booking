import { BillingService } from './billing.service';

/**
 * rt255 — the month-end invoice prices SMS / AI Hotline overage exactly as the
 * Usage screen does: the salon's own rate, else the platform default. Before,
 * a salon with no AI Hotline line (almost all) was invoiced nothing for SMS.
 */
function svc(o: { platform?: Record<string, string>; line?: Partial<{ includedSms: number; overageCentsPerSms: number; includedMinutes: number; overageCentsPerMin: number }>; smsSent: number; minutes?: number; planSms: number }) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ plan: { currency: 'USD', maxSmsPerMonth: o.planSms } })) },
    platformConfig: { findMany: jest.fn(async () => Object.entries(o.platform ?? {}).map(([key, value]) => ({ key, value }))) },
  };
  const voice = {
    usageForMonth: jest.fn(async () => ({
      smsSent: o.smsSent, aiMinutes: o.minutes ?? 0,
      includedSms: o.line?.includedSms ?? 0, overageCentsPerSms: o.line?.overageCentsPerSms ?? 0,
      includedMinutes: o.line?.includedMinutes ?? 0, overageCentsPerMin: o.line?.overageCentsPerMin ?? 0,
    })),
  };
  const s = new BillingService(prisma as never, { log: jest.fn() } as never, {} as never, { get: () => undefined } as never, {} as never, {} as never, {} as never, voice as never);
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
