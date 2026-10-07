/** MỤC TIÊU RIÊNG: her targets, her numbers, nobody else's — one salon at a time. */
import { cleanGoal, goalProgress, hasGoal, weekAndMonth } from './goals';
import { PayrollService } from './payroll.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

jest.mock('./ledger-loader', () => ({
  loadLedger: jest.fn(async (_p: unknown, tenantId: string) => ({
    ledger: new Map(tenantId === 'A' ? [
      ['kim', { staffId: 'kim', days: { '2026-10-05': { serviceCents: 20000, visits: 2 }, '2026-10-08': { serviceCents: 30000, visits: 3 }, '2026-10-01': { serviceCents: 10000, visits: 1 } } }],
      ['lisa', { staffId: 'lisa', days: { '2026-10-08': { serviceCents: 99999, visits: 9 } } }],
    ] : []),
    orderCount: 0, extraVisits: 0, orders: [],
  })),
}));

describe('goal rules', () => {
  it('cleans what she typed; progress per goal she set', () => {
    expect(cleanGoal({ weekCents: '150000', monthCents: 0, weekVisits: -3, monthVisits: 40.4, junk: 1 })).toEqual({ weekCents: 150000, monthCents: null, weekVisits: null, monthVisits: 40 });
    expect(hasGoal(cleanGoal(null))).toBe(false);
    const p = goalProgress({ weekCents: 100000, monthCents: null, weekVisits: 5, monthVisits: 10 }, { serviceCents: 50000, visits: 6 }, { serviceCents: 60000, visits: 6 });
    expect(p.map((x) => [x.key, x.pct, x.done])).toEqual([['weekCents', 50, false], ['weekVisits', 100, true], ['monthVisits', 60, false]]);
    expect(p[0].left).toBe(50000);
  });
  it('Monday–Sunday and the calendar month', () => {
    expect(weekAndMonth('2026-10-08')).toEqual({ week: { from: '2026-10-05', to: '2026-10-11' }, month: { from: '2026-10-01', to: '2026-10-31' } });
    expect(weekAndMonth('2026-11-01').week).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('her goals in her salon', () => {
  function make() {
    const seen: string[] = [];
    const store: Record<string, Row> = {};
    const prisma: Row = {
      tenant: { findUnique: async () => ({ timezone: 'America/Edmonton' }) },
      setting: {
        findUnique: async ({ where }: Row) => { seen.push(where.tenantId_key.tenantId); const v = store[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`]; return v ? { value: v } : null; },
        upsert: async ({ where, create }: Row) => { seen.push(where.tenantId_key.tenantId); store[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`] = create.value; return create; },
      },
      staffMember: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return where.tenantId === 'A' && where.userId === 'u-kim' ? { id: 'kim' } : null; } },
    };
    return { svc: new PayrollService(prisma as never, { log: jest.fn() } as never), seen, store };
  }
  const kim = { userId: 'u-kim', role: 'STAFF', tenantId: 'A' } as never;
  const NOW = new Date('2026-10-08T22:00:00Z'); // Thu Oct 8, 4 PM Edmonton

  it('saves her targets under her own key and reads back her week and month — never lisa\'s', async () => {
    const { svc, seen, store } = make();
    await svc.saveMyGoals(kim, { weekCents: 100000, monthVisits: 20 });
    expect(Object.keys(store)).toEqual(['A:staff_goal:kim']);
    const r: Row = await svc.myGoals(kim, NOW);
    expect(r.week).toMatchObject({ from: '2026-10-05', to: '2026-10-11', serviceCents: 50000, visits: 5 });
    expect(r.month).toMatchObject({ from: '2026-10-01', serviceCents: 60000, visits: 6 });
    expect(r.progress.map((p: Row) => [p.key, p.pct])).toEqual([['weekCents', 50], ['monthVisits', 30]]);
    expect(JSON.stringify(r)).not.toContain('99999');
    expect(seen.every((t) => t === 'A')).toBe(true);
  });
  it('a login without a staff profile here has no goals', async () => {
    await expect(make().svc.myGoals({ userId: 'u-kim', role: 'STAFF', tenantId: 'B' } as never, NOW)).rejects.toThrow();
  });
});
