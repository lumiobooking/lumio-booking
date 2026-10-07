/** THU NHẬP CẢ NĂM: closed payslips of one year, her line alone, her salon alone. */
import { yearSummary, yearsWithPay } from './year-summary';
import { PayrollService } from './payroll.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const line = (staffId: string, net: number, extra: Row = {}) => ({ staffId, name: staffId, netPayCents: net, serviceCents: net * 2, tipsCents: 500, tipsNetCents: 480, cardTipFeeCents: 20, checkCents: net, cashCents: 0, visits: 3, ...extra });
const runs = [
  { periodFrom: '2025-12-29', periodTo: '2026-01-04', finalizedAt: new Date('2026-01-05T00:00:00Z'), lines: [line('kim', 1000), line('lisa', 5000)] }, // starts in 2025 → 2025
  { periodFrom: '2026-01-05', periodTo: '2026-01-11', finalizedAt: new Date('2026-01-12T00:00:00Z'), lines: [line('kim', 2000), line('lisa', 5000)] },
  { periodFrom: '2026-01-12', periodTo: '2026-01-18', finalizedAt: null, lines: [line('lisa', 5000)] }, // she had no line
  { periodFrom: '2026-02-02', periodTo: '2026-02-08', finalizedAt: new Date('2026-02-09T00:00:00Z'), lines: [line('kim', 3000, { adjustmentsCents: -100 })] },
];

describe('year summary', () => {
  it('adds her closed payslips of the year, by the period\'s first day; never a colleague\'s', () => {
    const { rows, totals } = yearSummary(runs, 'kim', 2026);
    expect(rows.map((r) => r.from)).toEqual(['2026-01-05', '2026-02-02']);
    expect(totals).toMatchObject({ periods: 2, netPayCents: 5000, serviceCents: 10000, tipsCents: 1000, tipsNetCents: 960, adjustmentsCents: -100, visits: 6, checkCents: 5000 });
    expect(yearSummary(runs, 'kim', 2025).totals.netPayCents).toBe(1000);
    expect(yearsWithPay(runs, 'kim')).toEqual([2026, 2025]);
    expect(yearsWithPay(runs, 'nobody')).toEqual([]);
  });
});

describe('the statement, one salon and one technician at a time', () => {
  function make(view = 'LIVE') {
    const seen: string[] = [];
    const prisma: Row = {
      tenant: { findUnique: async () => ({ name: 'Lumio Nails', timezone: 'America/Edmonton' }) },
      setting: { findUnique: async ({ where }: Row) => { seen.push(where.tenantId_key.tenantId); return where.tenantId_key.key === 'payroll' ? { value: { staffPayView: view } } : null; } },
      staffMember: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return where.tenantId === 'A' && where.userId === 'u-kim' ? { id: 'kim', firstName: 'Kim', lastName: null } : null; } },
      payrollRun: { findMany: async ({ where }: Row) => { seen.push(where.tenantId); return where.tenantId === 'A' && where.status === 'FINAL' ? runs : []; } },
    };
    return { svc: new PayrollService(prisma as never, { log: jest.fn() } as never), seen };
  }
  const kim = { userId: 'u-kim', role: 'STAFF', tenantId: 'A' } as never;
  const NOW = new Date('2026-10-08T22:00:00Z');

  it('her year, her name, the salon\'s name — and nothing of lisa', async () => {
    const { svc, seen } = make();
    const r: Row = await svc.myYear(kim, '2026', NOW);
    expect(r).toMatchObject({ year: 2026, years: [2026, 2025], name: 'Kim', salon: 'Lumio Nails' });
    expect(r.totals.netPayCents).toBe(5000);
    expect(JSON.stringify(r)).not.toContain('lisa');
    expect(seen.every((t) => t === 'A')).toBe(true);
    // No year asked: the latest year with pay.
    expect(((await svc.myYear(kim, undefined, NOW)) as Row).year).toBe(2026);
  });
  it('switched off by the owner: nothing; a login from another salon: nothing', async () => {
    expect(((await make('OFF').svc.myYear(kim, '2026', NOW)) as Row).totals).toBeNull();
    await expect(make().svc.myYear({ userId: 'u-kim', role: 'STAFF', tenantId: 'B' } as never, '2026', NOW)).rejects.toThrow();
  });
});
