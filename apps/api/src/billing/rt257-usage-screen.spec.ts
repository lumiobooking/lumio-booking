/**
 * rt257 — the Usage screen in a month before overage prices start: it shows
 * the real price and what the overage WOULD cost, charges nothing, and says
 * when charging starts — instead of "not priced yet". Also: which kinds of
 * text use the parts. Tenant-scoped: the summary reads only the caller's salon.
 */
import { BillingService } from './billing.service';

function make(o: { from?: string; periodStart: string; smsSent: number; segments: number; tenantSeen?: string[] }) {
  const seen: string[] = o.tenantSeen ?? [];
  const platformMap: Record<string, string> = { sms_overage_cents: '4', hotline_overage_cents_per_min: '25', ...(o.from ? { usage_rates_from: o.from } : {}) };
  const prisma = {
    tenant: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => { seen.push(where.id); return { market: 'US', plan: { name: 'Starter', currency: 'USD', priceMonthlyCents: 2900, maxSmsPerMonth: 100 } }; }) },
    platformConfig: { findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) => Object.entries(platformMap).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))) },
    voiceLine: { findUnique: jest.fn(async ({ where }: { where: { tenantId: string } }) => { seen.push(where.tenantId); return null; }) },
    setting: { findFirst: jest.fn(async () => null) },
    notification: { count: jest.fn(async ({ where }: { where: { tenantId: string } }) => { seen.push(where.tenantId); return 41; }) },
  };
  const platform = { get: jest.fn(async (k: string) => platformMap[k]) };
  const voice = {
    usage: jest.fn(async () => ({
      periodStart: o.periodStart, aiCalls: 0, aiMinutes: 0, smsSent: o.smsSent, smsSegments: o.segments,
      smsByKind: [{ kind: 'appointment', texts: o.smsSent, parts: o.segments, unicode: 0 }],
      monthlyCents: 0, includedMinutes: 0, includedSms: 0, overageCentsPerMin: 0, overageCentsPerSms: 0,
      overageMinutes: 0, overageSms: 0, overageCents: 0, hardCap: false,
    })),
  };
  const s = new BillingService(prisma as never, { log: jest.fn() } as never, {} as never, { get: () => undefined } as never, {} as never, {} as never, platform as never, voice as never);
  const anyS = s as unknown as Record<string, unknown>;
  anyS.paymentMethod = jest.fn(async () => null);
  anyS.chatRepliesThisMonth = jest.fn(async () => 0);
  return { s, seen };
}

const salonA = { tenantId: 'salon-a', role: 'SALON_ADMIN', userId: 'u1' } as never;

describe('rt257 usage screen before overage prices start', () => {
  it('November (before 2026-12): shows $0.04/part and $37.72 it would be, charges $0', async () => {
    const { s } = make({ from: '2026-12', periodStart: '2026-11-01T00:00:00.000Z', smsSent: 615, segments: 1043 });
    const r = await s.usageSummary(salonA);
    expect(r!.sms).toMatchObject({ included: 100, used: 1043, messages: 615, overage: 943, overageCentsPer: 4, overageCents: 0, wouldBeCents: 3772, wording: 'notYet' });
    expect(r!.sms.byKind).toEqual([{ kind: 'appointment', texts: 615, parts: 1043, unicode: 0 }]);
    expect(r!.usageStartsFrom).toBe('2026-12');
    expect(r!.totals.overageCents).toBe(0);
    expect(r!.totals.grandTotalCents).toBe(2900);
  });

  it('December (from the start month): the same usage is charged', async () => {
    const { s } = make({ from: '2026-12', periodStart: '2026-12-01T00:00:00.000Z', smsSent: 615, segments: 1043 });
    const r = await s.usageSummary(salonA);
    expect(r!.sms).toMatchObject({ overageCents: 3772, wording: 'priced' });
    expect(r!.sms.wouldBeCents).toBeUndefined();
    expect(r!.usageStartsFrom).toBeNull();
    expect(r!.totals.grandTotalCents).toBe(2900 + 3772);
  });

  it('reads only the caller\'s salon (no cross-tenant reads)', async () => {
    const seen: string[] = [];
    const { s } = make({ from: '2026-12', periodStart: '2026-11-01T00:00:00.000Z', smsSent: 10, segments: 10, tenantSeen: seen });
    await s.usageSummary(salonA);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['salon-a']));
  });
});
