import { ContentService } from './content.service';
import type { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * One salon must never see another salon's plan.
 *
 * The content engine reaches across more tables than anything else in the
 * product — bookings, customers, services, insights, ideas — so it is exactly
 * the kind of place where a missing `tenantId` hides for months. These tests
 * record every query the service makes and assert that each one is fenced.
 *
 * They use a recording stub rather than a database, so they run in a second and
 * catch the mistake at the point it is written.
 */

type Query = { model: string; op: string; args: Record<string, unknown> };

function recordingPrisma(queries: Query[]) {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => (args: Record<string, unknown> = {}) => {
        queries.push({ model: name, op, args });
        if (op === 'findMany') return Promise.resolve([]);
        if (op === 'findUnique' || op === 'findFirst') {
          return Promise.resolve(name === 'tenant'
            ? { name: 'Lux Nail Spa', timezone: 'America/Los_Angeles', businessType: 'SALON', market: 'US', city: 'Garden Grove', region: 'CA', postalCode: '92840' }
            : null);
        }
        if (op === 'updateMany') return Promise.resolve({ count: 1 });
        return Promise.resolve(null);
      },
    });
  return new Proxy({}, { get: (_t, name: string) => model(name) }) as never;
}

const svc = (queries: Query[]) =>
  new ContentService(recordingPrisma(queries), { get: async () => null } as never);

const userOf = (tenantId: string): AuthenticatedUser =>
  ({ userId: 'u1', tenantId, role: 'SALON_ADMIN', email: 'a@b.c' } as unknown as AuthenticatedUser);

/** Every `where` clause reachable in the args, however deeply nested. */
function wheres(args: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'where' && val && typeof val === 'object') out.push(val as Record<string, unknown>);
      walk(val);
    }
  };
  walk(args);
  return out;
}

describe('every read the content engine makes is fenced to one tenant', () => {
  const TENANT = 'tenant-aaa';

  it('scopes each tenant-owned table by tenantId', async () => {
    const q: Query[] = [];
    await svc(q).planFor(userOf(TENANT));

    // Tables that belong to a salon. `tenant` itself is addressed by primary
    // key, and the format/note libraries are platform-wide by design.
    const OWNED = ['appointment', 'customer', 'service', 'socialInsight', 'contentIdea', 'setting'];
    const touched = q.filter((x) => OWNED.includes(x.model));
    expect(touched.length).toBeGreaterThan(0);

    for (const call of touched) {
      const w = wheres(call.args);
      const fenced = w.some((x) => x.tenantId === TENANT);
      if (!fenced) throw new Error(`${call.model}.${call.op} ran without tenantId: ${JSON.stringify(call.args)}`);
    }
  });

  it('fences the opening assessment too, which reads more tables than the plan', async () => {
    // The onboarding report goes looking for connections, settings and the
    // service list all at once, and it is read by the agency rather than by
    // the salon — exactly the shape of screen where a missing tenantId shows
    // one client's shop to another and nobody notices for months.
    const q: Query[] = [];
    await svc(q).onboardingReport(userOf(TENANT));

    const OWNED = ['appointment', 'customer', 'service', 'socialInsight', 'contentIdea', 'setting',
      'googleReview', 'messengerConnection', 'messengerPage', 'marketingChannelConnection', 'staffMember'];
    const touched = q.filter((x) => OWNED.includes(x.model));
    expect(touched.length).toBeGreaterThan(0);
    for (const call of touched) {
      const w = wheres(call.args);
      if (!w.some((x) => x.tenantId === TENANT)) {
        throw new Error(`${call.model}.${call.op} ran without tenantId: ${JSON.stringify(call.args)}`);
      }
    }
  });

  it('reads the tenant row by its own id and no other', async () => {
    const q: Query[] = [];
    await svc(q).planFor(userOf(TENANT));
    for (const call of q.filter((x) => x.model === 'tenant')) {
      const w = wheres(call.args);
      expect(w.every((x) => x.id === TENANT || x.tenantId === TENANT)).toBe(true);
    }
  });

  it('never lets one salon mark another salon’s idea as done', async () => {
    const q: Query[] = [];
    await svc(q).setIdeaStatus(userOf(TENANT), 'idea-belonging-to-someone-else', 'posted');
    const update = q.find((x) => x.model === 'contentIdea' && x.op === 'updateMany');
    expect(update).toBeTruthy();
    // The id alone would be enough to find the row — the tenantId is what stops
    // a guessed id from reaching into another salon.
    expect((update!.args as { where: Record<string, unknown> }).where.tenantId).toBe(TENANT);
  });

  it('refuses to run at all without a tenant context', async () => {
    const q: Query[] = [];
    const noTenant = { userId: 'u1', role: 'SUPER_ADMIN' } as unknown as AuthenticatedUser;
    await expect(svc(q).planFor(noTenant)).rejects.toThrow();
    expect(q.filter((x) => x.model === 'appointment')).toHaveLength(0);
  });

  it('two salons produce two disjoint sets of queries', async () => {
    const a: Query[] = []; const b: Query[] = [];
    await svc(a).planFor(userOf('tenant-aaa'));
    await svc(b).planFor(userOf('tenant-bbb'));
    const idsIn = (q: Query[]) => new Set(q.flatMap((c) => wheres(c.args).map((w) => String(w.tenantId ?? w.id ?? ''))).filter(Boolean));
    expect(idsIn(a)).not.toContain('tenant-bbb');
    expect(idsIn(b)).not.toContain('tenant-aaa');
  });
});

describe('the plan it returns is shaped the way the screen expects', () => {
  it('carries region, events, week and trends', async () => {
    const q: Query[] = [];
    const plan = await svc(q).planFor(userOf('tenant-aaa')) as Record<string, unknown>;
    for (const key of ['region', 'events', 'week', 'trends', 'offer', 'lapsed']) {
      expect(plan[key]).toBeDefined();
    }
  });

  it('reports the region it was given rather than inventing one', async () => {
    const plan = await svc([]).planFor(userOf('tenant-aaa')) as { region: { label: string; known: boolean } };
    expect(plan.region.known).toBe(true);
    expect(plan.region.label).toBe('Garden Grove, CA');
  });

  it('gives a usable week even with an empty booking book', async () => {
    const plan = await svc([]).planFor(userOf('tenant-aaa')) as { week: { days: unknown[]; dataThin: boolean } };
    expect(plan.week.days).toHaveLength(7);
    expect(plan.week.dataThin).toBe(true);
  });
});

/**
 * The manual refresh button.
 *
 * Every press spends a real API call, so the interesting cases are not the
 * happy path — they are the sixth press, the crash halfway through, and the
 * salon next door.
 */
describe('refresh is capped, counted, and scoped', () => {
  /**
   * The network is stubbed for this whole block, and that is not a detail.
   *
   * The first version of these tests let `refreshFor` run with whatever
   * ANTHROPIC_API_KEY happened to be in the environment. On this machine there
   * is none, so drafting bailed out instantly and all fourteen tests passed. On
   * the deploy machine the key is a REAL one — so the build was making real,
   * billable calls to Anthropic, with a 60-second timeout and two retries, and
   * jest killed both tests at its 5-second default. Two failures, one broken
   * deploy, and an invoice for the privilege.
   *
   * `voice-lang-flow.spec.ts` had this right already: set a fake key AND stub
   * fetch. A test that reaches the internet is not a unit test; it is a
   * different result on every machine that runs it.
   */
  let fetchSpy: jest.SpyInstance;
  const REPLY = {
    content: [{ type: 'text', text: JSON.stringify({ ideas: [
      { rank: 1, formatName: 'Before / after', title: 'A', hook: 'h', shotList: 's', caption: 'c', hashtags: '#a', bestTime: '18:30', reason: 'r' },
      { rank: 2, formatName: 'ASMR', title: 'B', hook: 'h', shotList: 's', caption: 'c', hashtags: '#b', bestTime: '18:30', reason: 'r' },
    ] }) }],
  };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one';
    fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true, status: 200, json: async () => REPLY,
    } as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.ANTHROPIC_API_KEY;
  });


  function prismaWith(setting: unknown, queries: Query[] = []) {
    const model = (name: string) =>
      new Proxy({}, {
        get: (_t, op: string) => (args: Record<string, unknown> = {}) => {
          queries.push({ model: name, op, args });
          if (name === 'setting' && (op === 'findFirst' || op === 'findUnique')) return Promise.resolve(setting);
          if (op === 'findUnique' && name === 'tenant') return Promise.resolve({ timezone: 'America/Los_Angeles', name: 'X', businessType: 'SALON', market: 'US' });
          if (op === 'findMany') return Promise.resolve([]);
          if (op === 'updateMany') return Promise.resolve({ count: 3 });
          return Promise.resolve({ id: 'row-1' });
        },
      });
    return new Proxy({}, { get: (_t, name: string) => model(name) }) as never;
  }
  const svcWith = (setting: unknown, q: Query[] = []) =>
    new ContentService(prismaWith(setting, q), { get: async () => null } as never);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  it('refuses the sixth press of the day, in words a person can act on', async () => {
    const svc = svcWith({ id: 's1', value: { date: today, count: 5 } });
    await expect(svc.refreshFor(userOf('t1'))).rejects.toThrow(/5 lần hôm nay/);
  });

  it('lets yesterday’s count go — the cap is daily, not lifetime', async () => {
    const q: Query[] = [];
    const svc = svcWith({ id: 's1', value: { date: '2020-01-01', count: 99 } }, q);
    const r = await svc.refreshFor(userOf('t1'));
    expect(r.left).toBe(4);
    expect(q.some((x) => x.model === 'setting' && x.op === 'update')).toBe(true);
  });

  it('counts the attempt BEFORE drafting, so a crash cannot buy a free retry', async () => {
    // Proved by removing the API key: drafting bails out immediately, and the
    // counter must STILL have been written. An earlier version of this test
    // wrapped the assertion in `if (drafted >= 0)`, which meant it quietly
    // asserted nothing on exactly this path — the one that matters.
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const q: Query[] = [];
      const r = await svcWith(null, q).refreshFor(userOf('t1'));
      expect(r.created).toBe(0);
      const wrote = q.find((x) => x.model === 'setting' && (x.op === 'create' || x.op === 'update'));
      expect(wrote).toBeTruthy();
      expect(r.left).toBe(4);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { if (old) process.env.ANTHROPIC_API_KEY = old; }
  });

  it('reads and writes the counter under this tenant only', async () => {
    const q: Query[] = [];
    await svcWith(null, q).refreshFor(userOf('tenant-aaa'));
    for (const call of q.filter((x) => x.model === 'setting')) {
      const w = wheres(call.args);
      const d = (call.args as { data?: Record<string, unknown> }).data;
      const fenced = w.some((x) => x.tenantId === 'tenant-aaa') || d?.tenantId === 'tenant-aaa' || w.some((x) => x.id === 's1');
      expect(fenced).toBe(true);
    }
  });

  it('says nothing was created when the model is unavailable, instead of pretending', async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await svcWith(null).refreshFor(userOf('t1'));
      expect(r.created).toBe(0);
      expect(r.skipped).toBe('no-api-key');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { if (old) process.env.ANTHROPIC_API_KEY = old; }
  });

  it('drafts and publishes in one step, without touching the network', async () => {
    const q: Query[] = [];
    const r = await svcWith(null, q).refreshFor(userOf('t1'));
    expect(r.created).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('api.anthropic.com');
    // Published, not left as a draft: this screen is the agency's own, and
    // there is no salon here to protect from unreviewed work.
    const pub = q.find((x) => x.model === 'contentIdea' && x.op === 'updateMany');
    expect((pub!.args as { data: Record<string, unknown> }).data.status).toBe('published');
    expect((pub!.args as { where: Record<string, unknown> }).where.tenantId).toBe('t1');
  });

  it('never lets a unit test reach the real API', () => {
    // Guarding the guard: if someone removes the fetch stub, this fails loudly
    // instead of quietly billing a deploy.
    expect(jest.isMockFunction(globalThis.fetch)).toBe(true);
  });

  it('still refuses without a tenant context', async () => {
    const noTenant = { userId: 'u1', role: 'SUPER_ADMIN' } as unknown as AuthenticatedUser;
    await expect(svcWith(null).refreshFor(noTenant)).rejects.toThrow();
  });
});
