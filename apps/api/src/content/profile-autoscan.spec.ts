import { ContentService } from './content.service';

/**
 * The profile scan, running without anyone pressing anything.
 *
 * The scan itself was always good. It ran exactly never on its own — only when
 * a Lumio person opened one salon's content screen and pressed a button — so a
 * salon nobody opened kept `businessType: SALON`, the enum default rather than
 * a decision, and every keyword set, playbook and calendar built downstream was
 * built for a generic salon instead of the nail bar or spa it actually was.
 *
 * What these tests protect is the sweep's manners, not the reading. A sweep
 * that retries a shop with no website every hour for ever would burn an AI call
 * an hour to learn the same nothing; a sweep that gives up after one bad minute
 * would leave a shop generic for good. Both failures are quiet, which is why
 * they are pinned here.
 */

type Row = { tenantId: string; value: unknown };

function stub(opts: { tenants: string[]; marks?: Row[] }) {
  const writes: { op: string; tenantId?: string; value?: unknown }[] = [];
  const marks = opts.marks ?? [];
  const handlers: Record<string, Record<string, (a: Record<string, unknown>) => Promise<unknown>>> = {
    tenant: {
      findMany: async () => opts.tenants.map((id) => ({ id })),
      findUnique: async () => null,
      update: async () => null,
    },
    setting: {
      findMany: async (a) => {
        const key = (a.where as { key?: string })?.key;
        return key === 'profile_scan' ? marks.map((m) => ({ ...m })) : [];
      },
      findFirst: async () => null,
      create: async (a) => {
        const d = a.data as { tenantId: string; key: string; value: unknown };
        if (d.key === 'profile_scan') writes.push({ op: 'mark', tenantId: d.tenantId, value: d.value });
        return null;
      },
      update: async () => null,
    },
    service: { findMany: async () => [] },
  };
  const prisma = new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, op: string) => handlers[model]?.[op] ?? (async () => (op === 'findMany' ? [] : null)),
    }),
  }) as never;
  return { svc: new ContentService(prisma, { get: async () => null } as never), writes };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('the profile scan sweeps by itself', () => {
  const KEY = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
  afterAll(() => { if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = KEY; });

  it('does nothing at all on a deployment with no AI key', async () => {
    // The Vietnam deployment runs without one by design. The old failure mode
    // was an ERROR line per tenant per hour, for ever, burying the lines that
    // matter and teaching everyone that ERROR means nothing.
    delete process.env.ANTHROPIC_API_KEY;
    const { svc, writes } = stub({ tenants: ['a', 'b'] });
    expect(await svc.scanNewProfiles()).toEqual({ scanned: 0, saved: 0 });
    expect(writes).toHaveLength(0);
  });

  it('reads a shop nobody has read, and remembers that it tried', async () => {
    const { svc, writes } = stub({ tenants: ['a'] });
    const r = await svc.scanNewProfiles();
    expect(r.scanned).toBe(1);
    // Nothing readable in the stub, so nothing is saved — but the attempt is
    // recorded, which is the whole point of the mark.
    expect(writes).toEqual([{ op: 'mark', tenantId: 'a', value: expect.objectContaining({ ok: false, tries: 1 }) }]);
  });

  it('never reads a shop it has already read', async () => {
    const { svc, writes } = stub({ tenants: ['a'], marks: [{ tenantId: 'a', value: { ok: true, tries: 1, at: daysAgo(400) } }] });
    expect((await svc.scanNewProfiles()).scanned).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('waits a week before trying a shop that failed, then tries again', async () => {
    // A shop with no website has nothing to read. Retrying it hourly buys the
    // same nothing at the price of an AI call an hour.
    const fresh = stub({ tenants: ['a'], marks: [{ tenantId: 'a', value: { ok: false, tries: 1, at: daysAgo(2) } }] });
    expect((await fresh.svc.scanNewProfiles()).scanned).toBe(0);

    // But a scan that failed because the model was briefly down deserves
    // another go, or one bad minute leaves a salon generic for good.
    const stale = stub({ tenants: ['a'], marks: [{ tenantId: 'a', value: { ok: false, tries: 1, at: daysAgo(9) } }] });
    expect((await stale.svc.scanNewProfiles()).scanned).toBe(1);
    expect(stale.writes[0]?.value).toEqual(expect.objectContaining({ tries: 2 }));
  });

  it('gives up after three tries rather than retrying for ever', async () => {
    const { svc } = stub({ tenants: ['a'], marks: [{ tenantId: 'a', value: { ok: false, tries: 3, at: daysAgo(90) } }] });
    expect((await svc.scanNewProfiles()).scanned).toBe(0);
  });

  it('takes a few salons per tick, not the whole table', async () => {
    // Five hundred scans on one tick is five hundred AI calls and a thousand
    // network reads — a self-inflicted outage on the hour this ships.
    const { svc } = stub({ tenants: Array.from({ length: 200 }, (_, i) => `t${i}`) });
    expect((await svc.scanNewProfiles()).scanned).toBe(5);
    expect((await svc.scanNewProfiles(2)).scanned).toBe(2);
  });

  it('does not let one broken salon stop the sweep', async () => {
    const { svc } = stub({ tenants: ['a', 'b', 'c'] });
    const boom = jest.spyOn(svc, 'scanProfileFor').mockRejectedValueOnce(new Error('website exploded'));
    const r = await svc.scanNewProfiles(3);
    expect(boom).toHaveBeenCalledTimes(3);
    expect(r.scanned).toBe(3);
  });
});
