/**
 * The queue: one open job per salon/month, a conditional claim, retries with
 * backoff, and a job that only ever syncs its own tenant.
 */
import { SyncQueueService } from './sync-queue.service';

type Row = Record<string, any>;

function fakeDb() {
  const jobs: Row[] = [];
  let seq = 0;
  const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'lte' in v) return r[k] <= v.lte;
    if (v && typeof v === 'object' && 'lt' in v) return r[k] < v.lt;
    if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(r[k]);
    return r[k] === v;
  });
  const prisma: any = {
    socialSyncJob: {
      findFirst: async ({ where }: Row) => jobs.find((r) => match(r, where)) ?? null,
      findMany: async ({ where, take, orderBy }: Row) => {
        let out = jobs.filter((r) => match(r, where ?? {}));
        if (orderBy?.runAt === 'asc') out = [...out].sort((a, b) => a.runAt - b.runAt);
        if (orderBy?.createdAt === 'desc') out = [...out].sort((a, b) => b.createdAt - a.createdAt);
        return take ? out.slice(0, take) : out;
      },
      create: async ({ data }: Row) => { const r = { id: `j${++seq}`, attempts: 0, startedAt: null, finishedAt: null, error: null, result: null, createdAt: new Date(), ...data }; jobs.push(r); return r; },
      update: async ({ where, data }: Row) => { const r = jobs.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
      updateMany: async ({ where, data }: Row) => {
        let count = 0;
        for (const r of jobs) if (match(r, where)) { count++; for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? r[k] + (v as Row).increment : v; }
        return { count };
      },
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    socialPost: { findMany: async () => [] },
    tenant: {
      findMany: async () => [{ id: 't1', timezone: 'America/Chicago' }, { id: 't2', timezone: 'Asia/Ho_Chi_Minh' }],
      findUnique: async ({ where }: Row) => ({ timezone: where.id === 't1' ? 'America/Chicago' : 'Asia/Ho_Chi_Minh' }),
    },
    messengerConnection: { findFirst: async ({ where }: Row) => (where.pageId === 'page1' ? { tenantId: 't1' } : null) },
  };
  return { prisma, jobs };
}

function make(marketing: Row) {
  const { prisma, jobs } = fakeDb();
  const svc = new SyncQueueService(prisma, marketing as never);
  return { svc, jobs };
}

describe('sync queue', () => {
  it('one open job per salon and month; the daily plan covers every active salon', async () => {
    const { svc, jobs } = make({});
    const a = await svc.enqueue('t1', '2026-10', 'daily');
    const b = await svc.enqueue('t1', '2026-10', 'webhook');
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const r = await svc.enqueueDaily(new Date('2026-10-03T12:00:00Z'));
    expect(r.tenants).toBe(2);
    expect(r.months).toEqual(['2026-09', '2026-10']);
    // t1 already had October queued → 1 new (Sept); t2 gets both.
    expect(r.jobs).toBe(3);
    expect(jobs.filter((j) => j.tenantId === 't2').map((j) => j.periodMonth).sort()).toEqual(['2026-09', '2026-10']);
  });

  it('a Page webhook queues that salon’s current month (salon calendar), a few minutes out', async () => {
    const { svc, jobs } = make({});
    expect(await svc.enqueueForPage('page1', new Date('2026-10-31T23:30:00Z'))).toBe(true); // 18:30 Oct 31 in Chicago
    expect(jobs[0]).toMatchObject({ tenantId: 't1', periodMonth: '2026-10', platform: 'meta_social', reason: 'webhook' });
    expect(await svc.enqueueForPage('unknown-page')).toBe(false);
    expect(jobs).toHaveLength(1);
  });

  it('runs due jobs for their own tenant only, retries a failure with backoff, gives up after three', async () => {
    const calls: Array<[string, string]> = [];
    let fail = true;
    const marketing = {
      syncAllChannels: async (_u: unknown, tenantId: string, month: string) => {
        calls.push([tenantId, month]);
        return fail ? { synced: 0, lines: [{ platform: 'meta_social', label: 'FB', state: 'error', message: 'HTTP 500' }], reviews: false }
          : { synced: 1, lines: [{ platform: 'meta_social', label: 'FB', state: 'synced', message: null }], reviews: true };
      },
    };
    const { svc, jobs } = make(marketing);
    await svc.enqueue('t1', '2026-10', 'daily');
    await svc.enqueue('t2', '2026-10', 'daily', null, new Date('2099-01-01')); // not due
    const now = new Date('2026-10-08T10:00:00Z');
    let r = await svc.runDue(3, now);
    expect(r).toEqual({ ran: 1, ok: 0, failed: 1 });
    expect(calls).toEqual([['t1', '2026-10']]);
    expect(jobs[0]).toMatchObject({ status: 'queued', attempts: 1, error: 'meta_social: HTTP 500' });
    expect(jobs[0].runAt.getTime()).toBeGreaterThan(now.getTime()); // backoff
    // Not due yet → nothing runs.
    expect(await svc.runDue(3, now)).toEqual({ ran: 0, ok: 0, failed: 0 });
    // Second and third tries fail → failed for good.
    await svc.runDue(3, new Date('2026-10-08T10:20:00Z'));
    await svc.runDue(3, new Date('2026-10-08T12:00:00Z'));
    expect(jobs[0]).toMatchObject({ status: 'failed', attempts: 3 });
    // A new job succeeds and records the lines.
    fail = false;
    await svc.enqueue('t1', '2026-10', 'manual');
    r = await svc.runDue(3, new Date('2026-10-08T13:00:00Z'));
    expect(r).toEqual({ ran: 1, ok: 1, failed: 0 });
    expect(jobs[2]).toMatchObject({ status: 'ok', error: null });
    expect(jobs[2].result[0].state).toBe('synced');
    expect(calls.every(([t]) => t === 't1')).toBe(true);
  });

  it('a job claimed by a process that died is re-queued', async () => {
    const { svc, jobs } = make({ syncAllChannels: async () => ({ synced: 1, lines: [], reviews: false }) });
    await svc.enqueue('t1', '2026-10', 'daily');
    jobs[0].status = 'running'; jobs[0].startedAt = new Date('2026-10-08T08:00:00Z'); jobs[0].attempts = 1;
    expect(await svc.requeueStale(new Date('2026-10-08T10:00:00Z'))).toBe(1);
    expect(jobs[0]).toMatchObject({ status: 'queued', error: 'worker lost (process restarted)' });
  });

  it('health reads this tenant’s channels and jobs only', async () => {
    const marketing = {
      listChannels: async () => [
        { platform: 'meta_social', label: 'FB/IG', connected: true, lastSyncedAt: null, lastError: null, enabled: true },
        { platform: 'tiktok', label: 'TikTok', connected: false, lastSyncedAt: null, lastError: null, enabled: true },
      ],
      resolveTenant: () => 't1',
    };
    const { svc, jobs } = make(marketing);
    await svc.enqueue('t2', '2026-10', 'daily');
    const j = await svc.enqueue('t1', '2026-10', 'daily');
    jobs.find((x) => x.id === j.id)!.status = 'ok';
    jobs.find((x) => x.id === j.id)!.finishedAt = new Date('2026-10-08T09:00:00Z');
    jobs.find((x) => x.id === j.id)!.result = [{ platform: 'meta_social', state: 'error', message: '(#200) Requires pages_read_engagement' }];
    const h = await svc.health({ userId: 'u', email: 'e', role: 'SALON_ADMIN', tenantId: 't1' } as never, '2026-10', undefined, new Date('2026-10-08T10:00:00Z'));
    expect(h.jobs.every((x) => x.id === j.id)).toBe(true);
    expect(h.channels.find((c) => c.platform === 'meta_social')).toMatchObject({ level: 'bad', key: 'permission', detail: 'pages_read_engagement' });
    expect(h.channels.find((c) => c.platform === 'tiktok')).toMatchObject({ level: 'off' });
  });
});
