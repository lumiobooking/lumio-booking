import * as fs from 'fs';
import * as path from 'path';
import { ContentService } from './content.service';
import { ContentAdminService } from './content-admin.service';
import { STARTER_FORMATS } from './starter-formats';
import { playbookFor } from './industry-playbook';
import { playsFor } from './promo-playbook';
import { profileFor } from './trend-sources';
import { viOf } from './i18n';

/**
 * Every trade on the platform must actually be served.
 *
 * The bug this file exists to prevent was invisible from the code and obvious
 * from the product: every client's screen looked like a nail salon's. The
 * per-industry logic was all written and all tested — and none of it ran,
 * because two lines defaulted to SALON:
 *
 *   - the 6am scheduler called generateAll('SALON'), so a restaurant or an
 *     estate agency never had a single idea generated. Not a poor idea. None.
 *   - seedFormats refused every industry but SALON, so those trades had an
 *     empty format library, and an empty library is a silent instruction to
 *     the model to improvise — which produces exactly the generic output the
 *     library was built to prevent.
 *
 * Unit tests on the industry variations could never have caught either one:
 * both are about what gets CALLED, not about what the functions return. So
 * these check the wiring.
 */

const TRADES = ['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE'] as const;

/**
 * The tenant list here comes back empty, so drafting is never reached and no
 * request would go out. The stub stays anyway: the schema guard bans any spec
 * that drives generateAll without it, and that rule is worth more blunt than
 * clever. The day someone adds a tenant to the stub below, this is what stops
 * the build from quietly calling a paid API on every deploy.
 */
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one';
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
    ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"ideas":[]}' }] }),
  } as never);
});
afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.ANTHROPIC_API_KEY;
});

type Query = { model: string; op: string; args: Record<string, unknown> };
function prismaSpy(queries: Query[], rows: unknown[] = []) {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => (args: Record<string, unknown> = {}) => {
        queries.push({ model: name, op, args });
        if (op === 'findMany') return Promise.resolve(rows);
        if (op === 'findUnique' || op === 'findFirst') return Promise.resolve(null);
        if (op === 'updateMany') return Promise.resolve({ count: 0 });
        return Promise.resolve({ id: 'x' });
      },
    });
  return new Proxy({}, { get: (_t, name: string) => model(name) }) as never;
}

describe('the nightly run covers every trade, not just nail', () => {
  it('asks for ALL active tenants when no industry is named', async () => {
    const q: Query[] = [];
    const svc = new ContentService(prismaSpy(q), { get: async () => null } as never);
    await svc.generateAll();
    const call = q.find((x) => x.model === 'tenant' && x.op === 'findMany')!;
    const where = (call.args as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('ACTIVE');
    // The line that starved every non-salon client for as long as it ran.
    expect(where.businessType).toBeUndefined();
  });

  it('still filters when an industry IS named', async () => {
    const q: Query[] = [];
    const svc = new ContentService(prismaSpy(q), { get: async () => null } as never);
    await svc.generateAll('RESTAURANT');
    const where = (q.find((x) => x.model === 'tenant')!.args as { where: Record<string, unknown> }).where;
    expect(where.businessType).toBe('RESTAURANT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the scheduler no longer hardcodes a trade', () => {
    // Read the source: this is a wiring bug, and only the call site proves it.
    const src = fs.readFileSync(path.join(__dirname, 'content.scheduler.ts'), 'utf8');
    expect(src).toMatch(/generateAll\(\s*\)/);
    expect(src).not.toMatch(/generateAll\(\s*['"]SALON['"]/);
  });
});

describe('every trade has a format library to draw from', () => {
  it.each(TRADES)('%s ships with starter formats', (t) => {
    const seeds = STARTER_FORMATS[t];
    expect(seeds?.length).toBeGreaterThanOrEqual(3);
    for (const f of seeds) {
      expect(f.name.length).toBeGreaterThan(3);
      expect(f.summary.length).toBeGreaterThan(30);
      expect(f.hookGuide.length).toBeGreaterThan(30);
      expect(f.shotList).toContain('·');
    }
  });

  it('seeds each trade under its OWN industry code', async () => {
    for (const t of TRADES) {
      const q: Query[] = [];
      const admin = new ContentAdminService(prismaSpy(q));
      await admin.seedFormats(t);
      const creates = q.filter((x) => x.model === 'contentFormat' && x.op === 'create');
      expect(creates.length).toBe(STARTER_FORMATS[t].length);
      for (const c of creates) {
        expect((c.args as { data: Record<string, unknown> }).data.industry).toBe(t);
      }
    }
  });

  it('names the trades it does have when asked for one it does not', async () => {
    const admin = new ContentAdminService(prismaSpy([]));
    await expect(admin.seedFormats('DENTIST')).rejects.toThrow(/SALON, RESTAURANT/);
  });

  it('does not label a restaurant format as nail', async () => {
    const q: Query[] = [];
    await new ContentAdminService(prismaSpy(q)).seedFormats('RESTAURANT');
    for (const c of q.filter((x) => x.op === 'create')) {
      expect((c.args as { data: Record<string, unknown> }).data.niche).toBeNull();
    }
  });
});

describe('no trade falls back to nail vocabulary anywhere', () => {
  const NAIL = /móng|nail|manicure|pedicure/i;

  it.each(['RESTAURANT', 'REAL_ESTATE'] as const)('%s playbook is free of it', (t) => {
    expect(JSON.stringify(playbookFor(t))).not.toMatch(NAIL);
  });

  it.each(['RESTAURANT', 'REAL_ESTATE'] as const)('%s promo plays are free of it', (t) => {
    expect(JSON.stringify(playsFor(t))).not.toMatch(NAIL);
  });

  it.each(['RESTAURANT', 'REAL_ESTATE'] as const)('%s starter formats are free of it', (t) => {
    expect(JSON.stringify(STARTER_FORMATS[t])).not.toMatch(NAIL);
  });

  it.each(['RESTAURANT', 'REAL_ESTATE'] as const)('%s trend queries are free of it', (t) => {
    expect(JSON.stringify(profileFor(t))).not.toMatch(NAIL);
  });

  it('gives each trade a distinct name the screen can show', () => {
    // Compared on the Vietnamese side: the trade label is bilingual now, and a
    // Set of {vi,en} objects is a set of distinct references — it would pass
    // even if all four trades were called the same thing.
    const trades = TRADES.map((t) => viOf(playbookFor(t).trade));
    // SERVICE and SALON deliberately share a promo table, but never a label:
    // the label is what tells an operator the industry was set wrong.
    expect(new Set(trades).size).toBe(TRADES.length);
  });
});
