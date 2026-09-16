import {
  addCall, byFeature, byHour, byTenant, cacheHitRate, cleanCounts, cleanDay, costOf, emptyDay,
  mergeDay, mergeDays, priceOf, recentDays, totals, type AiCall,
} from './ai-usage';
import { anthropicUsage } from './llm';

const call = (over: Partial<AiCall> = {}): AiCall => ({
  feature: 'content-ideas', tenantId: 't1', model: 'claude-haiku-4-5-20251001',
  input: 10_000, output: 1_000, hour: 9, ...over,
});

describe('pricing a model id', () => {
  it('prices a dated snapshot like the model it is a snapshot of', () => {
    expect(priceOf('claude-haiku-4-5-20251001')).toEqual(priceOf('claude-haiku-4-5'));
    expect(priceOf('claude-haiku-4-5-20251001').known).toBe(true);
  });
  it('falls back for a model nobody has priced, and says so', () => {
    expect(priceOf('some-new-model').known).toBe(false);
    expect(priceOf('some-new-model').price.input).toBeGreaterThan(0);
  });
  it('charges cache reads a fraction of fresh input — the whole point of caching', () => {
    const fresh = costOf([1_000_000, 0, 0, 0, 1, 0], 'claude-haiku-4-5');
    const cached = costOf([0, 0, 1_000_000, 0, 1, 0], 'claude-haiku-4-5');
    expect(fresh).toBeCloseTo(1, 6);
    expect(cached).toBeCloseTo(0.1, 6);
  });
});

describe('recording calls', () => {
  it('files one call under its feature, its salon and its hour at once', () => {
    const d = addCall(emptyDay('2026-09-16'), call());
    expect(d.f['content-ideas']['claude-haiku-4-5-20251001']).toEqual([10_000, 1_000, 0, 0, 1, 0]);
    expect(d.t.t1['content-ideas'][4]).toBe(1);
    expect(d.h['9'][4]).toBe(1);
  });

  it('files platform work under no salon rather than inventing one', () => {
    const d = addCall(emptyDay('2026-09-16'), call({ tenantId: null }));
    expect(Object.keys(d.t)).toEqual(['']);
  });

  it('counts a failed call — a retry storm costs money and must be visible', () => {
    const d = emptyDay('2026-09-16');
    addCall(d, call({ failed: true }));
    addCall(d, call());
    expect(totals(d)).toMatchObject({ calls: 2, errors: 1 });
  });

  it('names an unknown feature "other" instead of growing a key per typo', () => {
    const d = addCall(emptyDay('2026-09-16'), call({ feature: 'nonsense' as never }));
    expect(Object.keys(d.f)).toEqual(['other']);
  });

  it('clamps an impossible hour rather than storing it', () => {
    const d = emptyDay('2026-09-16');
    addCall(d, call({ hour: 99 }));
    addCall(d, call({ hour: -3 }));
    expect(Object.keys(d.h).sort()).toEqual(['0', '23']);
  });
});

describe('four services, one day', () => {
  it('sums the rows each process wrote instead of one clobbering the next', () => {
    const a = addCall(emptyDay('2026-09-16'), call({ input: 100, output: 10 }));
    const b = addCall(emptyDay('2026-09-16'), call({ input: 400, output: 40 }));
    const m = mergeDays([a, b], '2026-09-16');
    expect(m.f['content-ideas']['claude-haiku-4-5-20251001']).toEqual([500, 50, 0, 0, 2, 0]);
    expect(totals(m).calls).toBe(2);
  });

  it('merging never loses a feature only one process saw', () => {
    const a = addCall(emptyDay('2026-09-16'), call({ feature: 'messenger' }));
    const b = addCall(emptyDay('2026-09-16'), call({ feature: 'gbp-screen' }));
    expect(Object.keys(mergeDay(a, b).f).sort()).toEqual(['gbp-screen', 'messenger']);
  });
});

describe('a stored row that has gone bad', () => {
  it('reads junk as zero rather than poisoning the total', () => {
    expect(cleanCounts(['x', -5, null, 3.7, undefined, 2])).toEqual([0, 0, 0, 4, 0, 2]);
    expect(cleanCounts('nope')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(totals(cleanDay('garbage', '2026-09-16')).usd).toBe(0);
  });
  it('keeps what is readable inside a half-broken row', () => {
    const d = cleanDay({ f: { messenger: { 'claude-haiku-4-5': [1000, 100, 0, 0, 1, 0], bad: 'x' } } }, '2026-09-16');
    expect(d.f.messenger['claude-haiku-4-5'][0]).toBe(1000);
    expect(d.f.messenger.bad).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('the report a person actually reads', () => {
  const day = (() => {
    const d = emptyDay('2026-09-16');
    // the planner: 55 salons, one big call each, nothing cached
    for (let i = 0; i < 55; i += 1) addCall(d, call({ tenantId: `t${i}`, input: 9_000, output: 1_800, hour: 7 }));
    // the bot: a few chats, mostly cached
    for (let i = 0; i < 20; i += 1) {
      addCall(d, call({ feature: 'messenger', tenantId: 't1', input: 500, output: 300, cacheRead: 4_000, hour: 14 }));
    }
    return d;
  })();

  it('puts the dearest feature first and says which of them runs on a timer', () => {
    const rows = byFeature(day);
    expect(rows[0].feature).toBe('content-ideas');
    expect(rows[0].automatic).toBe(true);
    expect(rows[0].calls).toBe(55);
    expect(rows[0].usd).toBeGreaterThan(rows[1].usd);
    expect(rows.find((r) => r.feature === 'messenger')?.automatic).toBe(false);
  });

  it('names the salons that cost the most, and what they cost it on', () => {
    const rows = byTenant(day);
    expect(rows[0].tenantId).toBe('t1');           // drafting AND twenty chats
    // and its dearest line is the chatting, not the drafting: twenty cached
    // replies at 2,400 priced tokens each beat one 10,800-token draft
    expect(rows[0].features.map((f) => f.feature)).toEqual(['messenger', 'content-ideas']);
    expect(rows[0].usd).toBeGreaterThan(rows[1].usd);
    expect(rows).toHaveLength(55);
  });

  it('shows the hour the money left — a 7am spike nobody was awake for', () => {
    const hours = byHour(day);
    expect(hours).toHaveLength(24);
    expect(hours[7].calls).toBe(55);
    expect(hours[14].calls).toBe(20);
    expect(hours[3].calls).toBe(0);
  });

  it('gives the cache hit rate per feature, which is where the console cannot look', () => {
    expect(cacheHitRate(day, 'content-ideas')).toBe(0);
    expect(cacheHitRate(day, 'messenger')).toBeGreaterThan(0.8);
  });

  it('flags an estimate rather than quietly pricing an unknown model as if it knew', () => {
    const d = addCall(emptyDay('2026-09-16'), call({ model: 'claude-brand-new' }));
    expect(totals(d).estimated).toBe(true);
    expect(byFeature(d)[0].estimated).toBe(true);
  });
});

describe('the days a report covers', () => {
  it('ends today and runs backwards, oldest first', () => {
    expect(recentDays(new Date('2026-09-16T05:00:00Z'), 3)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(recentDays(new Date('2027-01-01T00:30:00Z'), 2)).toEqual(['2026-12-31', '2027-01-01']);
  });
});

describe('reading the provider’s own counters', () => {
  it('normalises Anthropic’s four numbers and keeps the model that answered', () => {
    expect(anthropicUsage({ input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 4000 }, 'claude-haiku-4-5'))
      .toEqual({ input: 900, output: 120, cacheRead: 4000, cacheWrite: 0, model: 'claude-haiku-4-5' });
  });
  it('reads a missing or nonsense counter as zero, never as NaN', () => {
    const u = anthropicUsage(undefined, 'm');
    expect(u).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: 'm' });
    expect(anthropicUsage({ input_tokens: -5 } as never, 'm').input).toBe(0);
    expect(costOf([u.input, u.output, u.cacheRead, u.cacheWrite, 1, 0], 'm')).toBe(0);
  });
});
