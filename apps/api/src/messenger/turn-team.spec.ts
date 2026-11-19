import { adWaits, cleanTeam, maskPhone, nightText, pickWeighted, poolsFor, scoreboard, sourceOf, takesSource, type LogRow, type ThreadFacts } from './turn-team';
import { ChatTurnsService } from './chat-turns.service';

const ag = (userId: string, o: Partial<{ onShift: boolean; openThreads: number; turnsToday: number }> = {}) => ({ userId, onShift: true, openThreads: 0, turnsToday: 0, ...o });

describe('chia turn đợt 2 — team rules', () => {
  it('cleans the team and keeps only this salon’s people', () => {
    const t = cleanTeam({ members: { lan: { group: 'A', weight: 50, sources: ['111|messenger', 'bad'] }, stranger: { group: 'B' } }, staffSeeAll: false, adCostCents: -5 }, new Set(['lan']));
    expect(Object.keys(t.members)).toEqual(['lan']);
    expect(t.members.lan.sources).toEqual(['111|messenger']);
    expect(t.staffSeeAll).toBe(false);
    expect(t.adCostCents).toBe(0);
    expect(t.adGroupFirst).toBe(true);
  });

  it('a person limited to some Pages takes only those', () => {
    const m = { group: 'A' as const, weight: 1, sources: [sourceOf('111', 'instagram')] };
    expect(takesSource(m, '111|instagram')).toBe(true);
    expect(takesSource(m, '111|messenger')).toBe(false);
    expect(takesSource(undefined, '111|messenger')).toBe(true);
  });

  it('ad customers go to group A first, then everyone', () => {
    const team = cleanTeam({ members: { lan: { group: 'A' }, minh: { group: 'A' }, ha: { group: 'B' } } });
    const pools = poolsFor([ag('lan'), ag('minh'), ag('ha')], team, { source: '1|messenger', fromAd: true });
    expect(pools.map((p) => p.map((a) => a.userId))).toEqual([['lan', 'minh'], ['lan', 'minh', 'ha']]);
    expect(poolsFor([ag('lan'), ag('ha')], team, { source: '1|messenger', fromAd: false })).toHaveLength(1);
    const noFirst = cleanTeam({ ...team, adGroupFirst: false });
    expect(poolsFor([ag('lan'), ag('ha')], noFirst, { source: '1|messenger', fromAd: true })).toHaveLength(1);
  });

  it('weighted turns go to whoever is furthest below their share', () => {
    const team = cleanTeam({ members: { lan: { weight: 50 }, minh: { weight: 30 }, ha: { weight: 20 } } });
    expect(pickWeighted([ag('lan', { turnsToday: 5 }), ag('minh', { turnsToday: 1 }), ag('ha', { turnsToday: 2 })], team, 5)).toBe('minh');
    expect(pickWeighted([ag('lan'), ag('minh'), ag('ha')], team, 5)).toBe('lan');
    // Weight 0 takes no automatic turns; full or off duty neither.
    const zero = cleanTeam({ members: { lan: { weight: 0 }, minh: { weight: 30 } } });
    expect(pickWeighted([ag('lan'), ag('minh', { openThreads: 5 })], zero, 5)).toBeNull();
    expect(pickWeighted([ag('lan', { onShift: false }), ag('minh')], team, 5, 'minh')).toBeNull();
  });

  it('masks phone numbers for staff', () => {
    expect(maskPhone('0913 456 142')).toBe('•••• 6142');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('chia turn đợt 3 — scoreboard', () => {
  const t0 = new Date('2026-11-19T02:00:00Z');
  const at = (m: number) => new Date(t0.getTime() + m * 60_000);
  const logs: LogRow[] = [
    { threadId: 'a', userId: 'lan', fromUserId: null, reason: 'round-robin', createdAt: at(0) },
    { threadId: 'a', userId: 'lan', fromUserId: null, reason: 'first-reply', createdAt: at(1) },
    { threadId: 'b', userId: 'ha', fromUserId: null, reason: 'round-robin', createdAt: at(0) },
    { threadId: 'b', userId: 'lan', fromUserId: 'ha', reason: 'reassign-unreplied', createdAt: at(5) },
    { threadId: 'b', userId: 'lan', fromUserId: null, reason: 'first-reply', createdAt: at(8) },
    { threadId: 'c', userId: 'ha', fromUserId: null, reason: 'round-robin', createdAt: at(10) },
    // Ha's reply on b came after the turn left her: it does not count for her.
    { threadId: 'b', userId: 'ha', fromUserId: null, reason: 'first-reply', createdAt: at(9) },
  ];
  const facts = new Map<string, ThreadFacts>([['a', { id: 'a', adId: 'ad', adAt: at(0), customerId: 'c1' }], ['b', { id: 'b', adId: null, adAt: null, customerId: null }]]);

  it('times each person’s first answer on the turns they held, and counts turns lost', () => {
    const s = scoreboard(logs, facts, (t) => (t?.adId ? 2 : 5));
    const lan = s.find((x) => x.userId === 'lan')!;
    const ha = s.find((x) => x.userId === 'ha')!;
    expect(lan).toMatchObject({ received: 2, answered: 2, medianSec: 60, onTimePct: 100, lost: 0, withCustomer: 1 });
    expect(ha).toMatchObject({ received: 2, answered: 0, lost: 1, medianSec: null, onTimePct: 0 });
  });

  it('ad customers left waiting past the limit, answered late or never', () => {
    const now = at(30);
    const ad: ThreadFacts[] = [{ id: 'x', adId: 'a', adAt: at(0), customerId: null }, { id: 'y', adId: 'a', adAt: at(0), customerId: null }, { id: 'z', adId: 'a', adAt: at(29), customerId: null }];
    const first = new Map([['x', at(1)], ['y', at(4)]]);
    expect(adWaits(ad, first, 2, now)).toBe(1);
    expect(adWaits(ad, new Map(), 2, now)).toBe(2);
    expect(adWaits(ad, first, 0, now)).toBe(0);
  });

  it('the evening summary', () => {
    const s = nightText({ scores: [{ name: 'Lan', received: 24, medianSec: 70, lost: 3 }], adWaiting: 7, money: '350.000' });
    expect(s).toContain('Lan: 24 khách · trả lời 1p10 · bỏ turn 3');
    expect(s).toContain('7 khách quảng cáo');
  });
});

describe('chia turn đợt 2 — one salon at a time', () => {
  function svc(settings: Map<string, unknown>) {
    const prisma = {
      user: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' ? [{ id: 'lan' }] : [{ id: 'bao' }])) },
      setting: {
        findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => { const v = settings.get(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`); return v === undefined ? null : { value: v }; }),
        upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => { settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {}; }),
      },
      messengerPage: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    return new ChatTurnsService(prisma as never, { publish: jest.fn() } as never);
  }
  it('a salon’s team keeps only its own people; staff cannot save it', async () => {
    const settings = new Map<string, unknown>();
    const s = svc(settings);
    await s.saveTeam({ userId: 'o', role: 'SALON_ADMIN', tenantId: 'A' } as never, { members: { lan: { group: 'A' }, bao: { group: 'B' } } });
    expect(Object.keys((settings.get('A|messenger.turn_team') as { members: object }).members)).toEqual(['lan']);
    expect(settings.get('B|messenger.turn_team')).toBeUndefined();
    await expect(s.saveTeam({ userId: 'lan', role: 'STAFF', tenantId: 'A' } as never, {})).rejects.toThrow();
  });
});
