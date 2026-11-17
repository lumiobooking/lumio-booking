import { GOLDEN_FRESH_MS, accountResult, bestBefore, conductOk, goldenFrom, goldenVerdict, pctlMs, promotionGate, type GoldenItem, type GoldenRecord } from './ai-golden';

const item = (id: string, o: Partial<GoldenItem> = {}): GoldenItem => ({ id, lang: 'vi', pass: true, why: '', ms: 3000, hard: [], ...o });
const NOW = Date.parse('2026-11-18T03:00:00.000Z');
const passed = (o: Partial<GoldenRecord> = {}): GoldenRecord => ({ commit: 'abc1234', at: new Date(NOW - 3600_000).toISOString(), state: 'done', live: ['thinkAhead', 'quickRepair', 'smartWait'], accounts: [], ok: true, why: [], ...o });

describe('the golden run: one account\'s numbers', () => {
  it('a script counts as passed only when it was graded a pass AND had no hard fault', () => {
    const a = accountResult({ name: 'Lumio Salon', mode: 'booking', steps: [{ p: 300, m: 2000, j: 1000, r: 0 }, { p: 400, m: 5000, j: 2000, r: 1 }],
      items: [item('greeting'), item('price', { pass: false, why: 'invented a price' }), item('unknown', { hard: ['leak'] }), item('group', { ms: 9000 })] });
    expect(a).toMatchObject({ passed: 2, total: 4, failed: ['price:vi', 'unknown:vi'], hard: 1, medianMs: 3000, p90Ms: 9000, rewriteRate: 0.5 });
    expect(a.steps).toEqual({ prepMs: 300, modelMs: 2000, checkMs: 1000 });
  });

  it('percentiles ignore what is not a time', () => {
    expect(pctlMs([], 0.5)).toBeNull();
    expect(pctlMs([NaN, -1, 2000, 4000, 3000], 0.5)).toBe(3000);
  });
});

describe('the golden run: did it pass?', () => {
  const good = accountResult({ name: 'Lumio Salon', mode: 'booking', steps: [], items: Array.from({ length: 20 }, (_, i) => item(`s${i}`, { pass: i !== 3 })) }); // 19/20
  it('passes with nearly every script right, no hard fault, and a quick AI', () => {
    expect(goldenVerdict([good])).toEqual({ ok: true, why: [] });
  });
  it('fails on too few scripts, on ANY hard fault, and on a slow AI — each named', () => {
    const few = accountResult({ name: 'A', mode: 'sales', steps: [], items: Array.from({ length: 10 }, (_, i) => item(`s${i}`, { pass: i > 2 })) }); // 7/10
    expect(goldenVerdict([good, few]).why.join(' ')).toContain('A: chỉ 7/10');
    const hard = accountResult({ name: 'B', mode: 'booking', steps: [], items: [...Array.from({ length: 19 }, (_, i) => item(`s${i}`)), item('x', { hard: ['apology'] })] });
    expect(goldenVerdict([hard]).ok).toBe(false);
    expect(goldenVerdict([hard]).why.join(' ')).toContain('lỗi nặng');
    const slow = accountResult({ name: 'C', mode: 'booking', steps: [], items: Array.from({ length: 10 }, (_, i) => item(`s${i}`, { ms: 9000 })) });
    expect(goldenVerdict([slow]).why.join(' ')).toContain('soạn chậm');
  });
  it('an account with messy notes of its own does not hold every release back for ever: "not worse than its own best" also passes', () => {
    // 15/20 = 75%: under the bar outright …
    expect(conductOk({ passed: 15, total: 20, best: null })).toBe(false);
    // … but this account has never done better than 16 on these scripts: the build did not make it worse.
    expect(conductOk({ passed: 15, total: 20, best: 16 })).toBe(true);
    expect(conductOk({ passed: 14, total: 20, best: 16 })).toBe(false); // two scripts worse: a change somebody must look at
    // The best is kept, so a slow slide (16 → 15 → 14 …) is caught at the second step.
    const prev: GoldenRecord = { commit: 'p', at: 'x', state: 'done', live: [], ok: true, why: [], accounts: [{ name: 'A', mode: 'sales', passed: 15, total: 20, failed: [], hard: 0, medianMs: null, p90Ms: null, rewriteRate: null, steps: null, best: 16 }] };
    expect(bestBefore(prev, 'A', 20)).toBe(16);
    expect(bestBefore(prev, 'A', 22)).toBeNull();          // other scripts: no comparison
    expect(bestBefore(prev, 'B', 20)).toBeNull();
    expect(bestBefore({ ...prev, state: 'error' }, 'A', 20)).toBeNull();
    // Never under the floor, whatever it scored before.
    expect(conductOk({ passed: 10, total: 20, best: 11 })).toBe(false);
    // And the bar outright still passes on its own.
    expect(conductOk({ passed: 17, total: 20, best: 20 })).toBe(true);
    const a = accountResult({ name: 'A', mode: 'sales', steps: [], best: 16, items: Array.from({ length: 20 }, (_, i) => item(`s${i}`, { pass: i >= 5 })) });
    expect(a.best).toBe(16);
    expect(goldenVerdict([a]).ok).toBe(true);
  });

  it('no test account, or an account where nothing ran, is not a pass', () => {
    expect(goldenVerdict([]).ok).toBe(false);
    expect(goldenVerdict([accountResult({ name: 'D', mode: 'booking', steps: [], items: [] })]).ok).toBe(false);
  });
});

describe('the gate: a behaviour reaches every salon only on a passed run of THIS build', () => {
  const ask = (record: GoldenRecord | null, feature = 'thinkAhead', commit = 'abc1234') => promotionGate({ record, commit, feature, nowMs: NOW });
  it('opens for a passed, recent run of the running build with the behaviour live on the test accounts', () => {
    expect(ask(passed())).toEqual({ ok: true });
  });
  it.each([
    ['never run', null, 'never-run'],
    ['run on another build', passed({ commit: 'old9999' }), 'other-build'],
    ['still running', passed({ state: 'running', ok: false }), 'running'],
    ['broke half-way', passed({ state: 'error', ok: false, error: 'anthropic 529' }), 'error'],
    ['did not pass', passed({ ok: false, why: ['Lumio Agency: chỉ 14/20 kịch bản đạt.'] }), 'failed'],
    ['passed more than a day ago', passed({ at: new Date(NOW - GOLDEN_FRESH_MS - 60_000).toISOString() }), 'stale'],
  ])('stays shut when %s', (_n, record, why) => {
    const g = ask(record as GoldenRecord | null);
    expect(g.ok).toBe(false);
    expect(g).toMatchObject({ why });
    expect((g as { vi: string }).vi.length).toBeGreaterThan(20);
  });
  it('stays shut for a behaviour that was NOT live on the test accounts while the run ran — the run said nothing about it', () => {
    expect(ask(passed({ live: ['smartWait'] }), 'thinkAhead')).toMatchObject({ ok: false, why: 'not-live' });
  });
  it('a development build is not gated', () => {
    expect(ask(null, 'thinkAhead', 'dev')).toEqual({ ok: true });
    expect(ask(null, 'thinkAhead', '')).toEqual({ ok: true });
  });
  it('reads a stored record defensively', () => {
    expect(goldenFrom(null)).toBeNull();
    expect(goldenFrom('{"commit":"a","at":"x","state":"weird"}')).toBeNull();
    expect(goldenFrom(JSON.stringify(passed()))?.ok).toBe(true);
    expect(goldenFrom('{"commit":"a","at":"2026-11-18T00:00:00Z","state":"done"}')).toMatchObject({ ok: false, live: [], accounts: [], why: [] });
  });
});
