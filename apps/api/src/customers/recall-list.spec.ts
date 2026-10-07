jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';
import { pruneContacted, recallList, RecallRow } from './recall-list';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('recall list — rules', () => {
  const base: Omit<RecallRow, 'id' | 'name'> = { phone: '555', months: 6, lastVisitEnd: daysAgo(200), hasUpcoming: false, remindedAt: null };
  it('due, soon (≤14 days), not yet, booked, no visit', () => {
    const out = recallList([
      { ...base, id: 'due', name: 'Due' },                                   // 6 months ≈183 days → 17 days overdue
      { ...base, id: 'soon', name: 'Soon', lastVisitEnd: daysAgo(175) },    // due in ~8 days
      { ...base, id: 'later', name: 'Later', lastVisitEnd: daysAgo(100) },
      { ...base, id: 'booked', name: 'Booked', hasUpcoming: true },
      { ...base, id: 'never', name: 'Never', lastVisitEnd: null },
    ], NOW);
    expect(out.map((x) => x.id)).toEqual(['due', 'soon']);
    expect(out[0].overdueDays).toBeGreaterThan(0);
    expect(out[1].overdueDays).toBeLessThan(0);
  });
  it('flags the automatic reminder already sent for this visit', () => {
    const [x] = recallList([{ ...base, id: 'a', name: 'A', remindedAt: daysAgo(5) }], NOW);
    expect(x.autoReminded).toBe(true);
  });
  it('"contacted" hides a patient for 14 days', () => {
    expect(recallList([{ ...base, id: 'a', name: 'A' }], NOW, { a: daysAgo(3).toISOString() })).toEqual([]);
    expect(recallList([{ ...base, id: 'a', name: 'A' }], NOW, { a: daysAgo(20).toISOString() })).toHaveLength(1);
    expect(pruneContacted({ a: daysAgo(3).toISOString(), b: daysAgo(20).toISOString(), c: 7 }, NOW)).toEqual({ a: daysAgo(3).toISOString() });
  });
});

describe('recall list — one clinic only', () => {
  function setup(industry: string) {
    const seen: Row[] = [];
    const cust = [
      { id: 'p1', tenantId: 'A', firstName: 'An', lastName: null, phone: '1', rebookRemindedAt: null, industryFields: { recallMonths: 6 } },
      { id: 'p2', tenantId: 'A', firstName: 'Bo', lastName: null, phone: '2', rebookRemindedAt: null, industryFields: {} },
    ];
    const prisma: Row = {
      tenant: { findUnique: jest.fn(async () => ({ businessType: industry === 'DENTAL' ? 'SERVICE' : 'SALON' })) },
      setting: {
        findUnique: jest.fn(async ({ where }: Row) => { seen.push({ tenantId: where.tenantId_key.tenantId }); return where.tenantId_key.key === 'industry' ? { value: { key: industry } } : null; }),
        upsert: jest.fn(async () => ({})),
      },
      customer: {
        findMany: jest.fn(async ({ where }: Row) => { seen.push(where); return cust.filter((c) => c.tenantId === where.tenantId); }),
        findFirst: jest.fn(async ({ where }: Row) => { seen.push(where); return cust.find((c) => c.tenantId === where.tenantId && c.id === where.id) ?? null; }),
      },
      appointment: {
        findMany: jest.fn(async ({ where }: Row) => { seen.push(where); return where.status === 'COMPLETED' ? [{ customerId: 'p1', endTime: daysAgo(200) }] : []; }),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new CustomersService(prisma as never, audit as never, {} as never), seen, prisma, audit };
  }
  const user = (t: string) => ({ userId: 'u', tenantId: t, role: 'SALON_ADMIN' } as never);

  it('lists due patients of this clinic, every read scoped', async () => {
    const { svc, seen } = setup('DENTAL');
    const out = await svc.recalls(user('A'), NOW);
    expect(out.items.map((x) => x.id)).toEqual(['p1']);
    expect(seen.every((w) => w.tenantId === 'A')).toBe(true);
  });
  it('a nail salon gets nothing (no queries for patients)', async () => {
    const { svc, prisma } = setup('NAIL');
    expect((await svc.recalls(user('A'), NOW)).items).toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
  it('cannot mark another clinic\'s patient', async () => {
    const { svc, prisma } = setup('DENTAL');
    await expect(svc.markRecallContacted(user('B'), 'p1', NOW)).rejects.toThrow();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
    await svc.markRecallContacted(user('A'), 'p1', NOW);
    expect(prisma.setting.upsert.mock.calls[0][0].where.tenantId_key).toEqual({ tenantId: 'A', key: 'recall_contacted' });
  });
});
