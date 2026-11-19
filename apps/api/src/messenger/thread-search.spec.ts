import { FOLD_FROM, FOLD_TO, foldText, searchPattern } from './thread-search';
import { MessengerService } from './messenger.service';

describe('rt214 — search folds accents like the screen does', () => {
  it('"hang" finds "Hằng", đ is d, spaces collapse', () => {
    expect(foldText('Nguyễn  Thị Hằng')).toBe('nguyen thi hang');
    expect(foldText('Đặng ĐỨC')).toBe('dang duc');
    expect(FOLD_FROM.length).toBe(FOLD_TO.length);
  });

  it('asks nothing under two letters; % and _ are literal', () => {
    expect(searchPattern(' a ')).toBeNull();
    expect(searchPattern('Hằng')).toBe('%hang%');
    expect(searchPattern('50%_off')).toBe('%50\\%\\_off%');
  });
});

/** Calls a private/public method of MessengerService on a fake `this`. */
function fake(opts: { staffSeeAll?: boolean } = {}) {
  const sqls: { values: unknown[] }[] = [];
  const counts: unknown[] = [];
  const self = {
    tenantId: (u: { tenantId: string }) => u.tenantId,
    turns: { teamOf: jest.fn(async () => ({ staffSeeAll: !!opts.staffSeeAll })) },
    prisma: {
      $queryRaw: jest.fn(async (sql: { values: unknown[] }) => { sqls.push(sql); return [{ id: 't1' }]; }),
      messengerThread: { count: jest.fn(async (a: unknown) => { counts.push(a); return 7; }) },
    },
  };
  const proto = MessengerService.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return {
    search: (tenantId: string, q: string, own: string | null) => proto.searchThreadIds.call(self, tenantId, q, own, 200) as Promise<string[] | null>,
    count: (user: unknown) => proto.countThreads.call(self, user) as Promise<{ total: number }>,
    sqls, counts,
  };
}

describe('rt214 — search and count stay inside one salon', () => {
  it('the database search is bound to the caller’s salon', async () => {
    const f = fake();
    expect(await f.search('A', 'hằng', null)).toEqual(['t1']);
    expect(f.sqls[0].values).toContain('A');
    expect(f.sqls[0].values).not.toContain('B');
    expect(f.sqls[0].values).toContain('%hang%');
  });

  it('staff who see only their own are searched only over their own and unclaimed', async () => {
    const f = fake();
    await f.search('A', 'lan', 'staff-1');
    expect(f.sqls[0].values).toContain('staff-1');
    await f.search('A', 'lan', null);
    expect(f.sqls[1].values).not.toContain('staff-1');
  });

  it('no search under two letters: the normal list is used', async () => {
    const f = fake();
    expect(await f.search('A', 'h', null)).toBeNull();
    expect(f.sqls).toHaveLength(0);
  });

  it('the total counts this salon only; staff count only their own when the team is set so', async () => {
    const f = fake();
    expect(await f.count({ userId: 'o', role: 'SALON_ADMIN', tenantId: 'A' })).toEqual({ total: 7 });
    expect(f.counts[0]).toMatchObject({ where: { tenantId: 'A' } });
    expect(JSON.stringify(f.counts[0])).not.toContain('assignedUserId');
    await f.count({ userId: 'lan', role: 'STAFF', tenantId: 'B' });
    expect(f.counts[1]).toMatchObject({ where: { tenantId: 'B', OR: [{ assignedUserId: 'lan' }, { assignedUserId: null }] } });
    const seeAll = fake({ staffSeeAll: true });
    await seeAll.count({ userId: 'lan', role: 'STAFF', tenantId: 'B' });
    expect(JSON.stringify(seeAll.counts[0])).not.toContain('assignedUserId');
  });
});
