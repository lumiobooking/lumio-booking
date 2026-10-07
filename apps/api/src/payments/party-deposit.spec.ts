jest.mock('../loyalty/loyalty.service', () => ({ LoyaltyService: class {} }));
import { cleanPartyDeposit, partyDepositCents, DEFAULT_PARTY_DEPOSIT } from './party-deposit';
import { PaymentsService } from './payments.service';

describe('party deposit — rules', () => {
  it('off by default', () => {
    expect(DEFAULT_PARTY_DEPOSIT.enabled).toBe(false);
    expect(partyDepositCents(20, DEFAULT_PARTY_DEPOSIT)).toBe(0);
  });
  it('per guest from the threshold', () => {
    const p = { enabled: true, fromParty: 8, perPersonCents: 1000 };
    expect(partyDepositCents(7, p)).toBe(0);
    expect(partyDepositCents(8, p)).toBe(8000);
    expect(partyDepositCents(null, p)).toBe(0);
  });
  it('cleans input, keeps the rest', () => {
    expect(cleanPartyDeposit({ enabled: true, fromParty: 1, perPersonCents: -5 })).toEqual({ enabled: true, fromParty: 2, perPersonCents: 0 });
    expect(cleanPartyDeposit({ fromParty: 'x' }, { enabled: true, fromParty: 10, perPersonCents: 500 })).toEqual({ enabled: true, fromParty: 10, perPersonCents: 500 });
  });
});

describe('depositFor — the larger of the salon rule and the party rule', () => {
  const svc = Object.create(PaymentsService.prototype) as PaymentsService;
  Object.assign(svc, { prisma: { appointment: { count: async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 't1' ? 0 : 99) } } });
  const salonRule = { enabled: true, type: 'percent' as const, percent: 30, fixedCents: 0, scope: 'all' as const, noShowThreshold: 2 };
  const party = { enabled: true, fromParty: 8, perPersonCents: 1000 };
  it('a restaurant table (no price) of 10 pays the party deposit', async () => {
    expect(await svc.depositFor('t1', { customerId: 'c', priceCents: 0, partySize: 10 }, salonRule, party)).toBe(10000);
  });
  it('a small party keeps the salon rule', async () => {
    expect(await svc.depositFor('t1', { customerId: 'c', priceCents: 10000, partySize: 2 }, salonRule, party)).toBe(3000);
  });
  it('both off: nothing', async () => {
    expect(await svc.depositFor('t1', { customerId: 'c', priceCents: 10000, partySize: 12 }, { ...salonRule, enabled: false }, { ...party, enabled: false })).toBe(0);
  });
});

describe('party deposit — stored per salon', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SettingsService } = require('../settings/settings.service');
  it('one salon\'s rule never reaches another', async () => {
    const rows: Record<string, unknown> = {};
    const prisma = {
      setting: {
        findUnique: jest.fn(async ({ where }: any) => { const v = rows[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`]; return v ? { value: v } : null; }), // eslint-disable-line @typescript-eslint/no-explicit-any
        upsert: jest.fn(async ({ where, create }: any) => { rows[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`] = create.value; return create; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new SettingsService(prisma, audit);
    const admin = (t: string) => ({ userId: 'u', role: 'SALON_ADMIN', tenantId: t });
    await svc.updatePartyDeposit(admin('A'), { enabled: true, fromParty: 6, perPersonCents: 2000 });
    expect(await svc.getPartyDeposit('A')).toEqual({ enabled: true, fromParty: 6, perPersonCents: 2000 });
    expect((await svc.getPartyDeposit('B')).enabled).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'settings.party_deposit_updated' }));
  });
});
