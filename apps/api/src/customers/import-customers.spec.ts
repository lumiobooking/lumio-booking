jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';
import { moneyToCents, normalizeImportRow, parseDate, phoneTail, toInt, yes } from './import-rows';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-08T12:00:00Z');

describe('reading an old client list', () => {
  it('money, counts, yes/no', () => {
    expect(moneyToCents('$1,234.50')).toBe(123450);
    expect(moneyToCents('1.234,50 €')).toBe(123450);
    expect(moneyToCents('85')).toBe(8500);
    expect(moneyToCents('-20')).toBe(0);
    expect(moneyToCents('n/a')).toBe(0);
    expect(toInt('12 visits')).toBe(12);
    expect(yes('Subscribed')).toBe(true);
    expect(yes('Yes')).toBe(true);
    expect(yes('Unsubscribed')).toBe(false);
    expect(yes('')).toBe(false);
  });
  it('dates as US/CA exports write them', () => {
    expect(parseDate('03/14/2024')!.toISOString().slice(0, 10)).toBe('2024-03-14');
    expect(parseDate('14/03/2024')!.toISOString().slice(0, 10)).toBe('2024-03-14');
    expect(parseDate('2024-03-14T10:22:00Z')!.toISOString().slice(0, 10)).toBe('2024-03-14');
    expect(parseDate('3/4/24')!.toISOString().slice(0, 10)).toBe('2024-03-04');
    expect(parseDate('Mar 14')!.toISOString().slice(0, 10)).toBe('2000-03-14');
    expect(parseDate('September 2, 2023')!.toISOString().slice(0, 10)).toBe('2023-09-02');
    expect(parseDate('02/30/2024')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
  it('a row: full name split, junk dropped, nothing to identify = skipped', () => {
    expect(normalizeImportRow({ name: 'Debbie Ann Smith', phone: '(403) 555-0100', email: 'NOPE', spent: '$410', visits: '7', points: '120', smsOptIn: 'Yes' })).toMatchObject({
      firstName: 'Debbie', lastName: 'Ann Smith', phone: '(403) 555-0100', email: null, spentCents: 41000, visits: 7, points: 120, smsOptIn: true,
    });
    expect(normalizeImportRow({ name: ' ', phone: '12', email: '' })).toBeNull();
    expect(phoneTail('+1 (403) 555-0100')).toBe('035550100');
  });
});

describe('importing into one salon', () => {
  function make(seed: Row[] = []) {
    const customers: Row[] = seed.map((c) => ({ smsConsent: false, importedAt: null, loyaltyPoints: 0, notes: null, birthDate: null, lastName: null, email: null, phone: null, ...c }));
    const ledger: Row[] = [];
    const scoped: string[] = [];
    const prisma: Row = {
      customer: {
        findMany: async ({ where }: Row) => { scoped.push(where.tenantId); return customers.filter((c) => c.tenantId === where.tenantId); },
        findFirst: async ({ where }: Row) => { scoped.push(where.tenantId); return customers.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null; },
        updateMany: async ({ where, data }: Row) => { scoped.push(where.tenantId); customers.filter((c) => c.id === where.id && c.tenantId === where.tenantId).forEach((c) => Object.assign(c, data)); return { count: 1 }; },
        create: async ({ data }: Row) => { const c = { id: `new${customers.length}`, loyaltyPoints: 0, smsConsent: false, ...data }; customers.push(c); return { id: c.id }; },
      },
      loyaltyTransaction: { create: async ({ data }: Row) => { ledger.push(data); return data; } },
    };
    const audit = { log: jest.fn() };
    return { svc: new CustomersService(prisma as never, audit as never, {} as never), customers, ledger, scoped, audit };
  }
  const owner = (t: string) => ({ userId: 'u', tenantId: t, role: 'SALON_ADMIN' } as never);

  it('creates new clients with their old history and points, and merges into an existing one', async () => {
    const { svc, customers, ledger, scoped } = make([{ id: 'c1', tenantId: 'A', firstName: 'Debbie', phone: '403-555-0100', loyaltyPoints: 10 }, { id: 'x', tenantId: 'B', firstName: 'Other', phone: '403-555-0100' }]);
    const r = await svc.importCustomers(owner('A'), {
      source: 'Square',
      rows: [
        { name: 'Debbie Smith', phone: '+1 (403) 555-0100', email: 'debbie@x.test', spent: '$410.00', visits: '7', lastVisit: '06/01/2026', points: '120' },
        { firstName: 'Aly', phone: '4035550111', spent: '95', points: '30', smsOptIn: 'yes' },
        { name: '', phone: '', email: '' },
      ],
    }, NOW);
    expect(r).toMatchObject({ created: 1, updated: 1, skipped: 1, pointsAdded: 150 });
    const debbie = customers.find((c) => c.id === 'c1')!;
    expect(debbie).toMatchObject({ lastName: 'Smith', email: 'debbie@x.test', importedSpentCents: 41000, importedVisits: 7, importSource: 'Square', loyaltyPoints: 130 });
    expect(debbie.lastVisitAt.toISOString().slice(0, 10)).toBe('2026-06-01');
    const aly = customers.find((c) => c.firstName === 'Aly')!;
    expect(aly.tenantId).toBe('A');
    expect(aly.smsConsent).toBe(false); // the row said yes, but the owner did not attest
    expect(customers.find((c) => c.id === 'x')!.importedAt).toBeNull(); // the other salon's client is untouched
    expect(ledger.every((l) => l.tenantId === 'A' && l.refType === 'import')).toBe(true);
    expect(scoped.every((t) => t === 'A')).toBe(true);
  });

  it('a re-import updates the history but never adds the points twice', async () => {
    const { svc, customers } = make();
    const row = { firstName: 'Lulu', phone: '4035550222', points: '50', spent: '100' };
    await svc.importCustomers(owner('A'), { rows: [row] }, NOW);
    const r = await svc.importCustomers(owner('A'), { rows: [{ ...row, spent: '150' }] }, NOW);
    expect(r).toMatchObject({ created: 0, updated: 1, pointsAdded: 0, pointsSkipped: 1 });
    const lulu = customers.find((c) => c.firstName === 'Lulu')!;
    expect(lulu.loyaltyPoints).toBe(50);
    expect(lulu.importedSpentCents).toBe(15000);
  });

  it('SMS consent only when the row says yes AND the owner attested', async () => {
    const { svc, customers } = make();
    await svc.importCustomers(owner('A'), { consentAttested: true, rows: [{ firstName: 'Yes', phone: '4035550333', smsOptIn: 'Subscribed' }, { firstName: 'No', phone: '4035550444', smsOptIn: 'no' }] }, NOW);
    expect(customers.find((c) => c.firstName === 'Yes')!.smsConsent).toBe(true);
    expect(customers.find((c) => c.firstName === 'No')!.smsConsent).toBe(false);
  });

  it('points by hand: added with a reason, never below zero, never on another salon\'s client', async () => {
    const { svc, customers, ledger } = make([{ id: 'c1', tenantId: 'A', firstName: 'Debbie', loyaltyPoints: 40 }]);
    (svc as unknown as { getById: () => Promise<unknown> }).getById = async () => ({});
    await svc.adjustPoints(owner('A'), 'c1', { points: -100, reason: 'Redeemed in old system' });
    expect(customers[0].loyaltyPoints).toBe(0);
    expect(ledger[0]).toMatchObject({ points: -40, balanceAfter: 0, refType: 'manual', reason: 'Redeemed in old system' });
    await expect(svc.adjustPoints(owner('B'), 'c1', { points: 10 })).rejects.toThrow();
  });
});
