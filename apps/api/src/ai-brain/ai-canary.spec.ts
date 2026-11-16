import { canaryDue, canaryFrom, canaryPush, canarySlug, canaryVerdict, type CanaryRecord } from './ai-canary';

const done = (commit: string, passed: number, total = 20): CanaryRecord => ({ commit, at: '2026-11-16T12:00:00Z', state: 'done', passed, total });

describe('the AI canary — once per deployed commit, on the platform’s own demo salon', () => {
  it('runs on our demo salon by default, another slug if named, never when switched off', () => {
    expect(canarySlug({})).toBe('lumio-salon');
    expect(canarySlug({ AI_CANARY_SLUG: ' lumio-demo ' })).toBe('lumio-demo');
    expect(canarySlug({ AI_CANARY: 'off' })).toBeNull();
  });

  it('is due once per commit — a restart of the same build does not run it again', () => {
    expect(canaryDue('abc1234', null)).toBe(true);
    expect(canaryDue('abc1234', done('zzz0000', 19))).toBe(true);
    expect(canaryDue('abc1234', done('abc1234', 19))).toBe(false);
    expect(canaryDue('abc1234', { commit: 'abc1234', at: 'x', state: 'running' })).toBe(false);
    expect(canaryDue('dev', null)).toBe(false);
    expect(canaryDue('', null)).toBe(false);
  });

  it('one script flipping is noise; two fewer, or under 80%, wakes the team', () => {
    expect(canaryVerdict({ passed: 19, total: 20 }, done('a', 20)).alert).toBe(false);
    expect(canaryVerdict({ passed: 18, total: 20 }, done('a', 20)).alert).toBe(true);
    expect(canaryVerdict({ passed: 15, total: 20 }, null).alert).toBe(true);
    expect(canaryVerdict({ passed: 17, total: 20 }, null).alert).toBe(false);
    // A different number of scripts is not comparable; an unfinished run is no baseline.
    expect(canaryVerdict({ passed: 14, total: 16 }, done('a', 20)).alert).toBe(false);
    expect(canaryVerdict({ passed: 17, total: 20 }, { commit: 'a', at: 'x', state: 'error' }).alert).toBe(false);
  });

  it('reads its record back safely and says which scripts failed', () => {
    expect(canaryFrom('nope')).toBeNull();
    expect(canaryFrom(JSON.stringify(done('a', 19)))?.passed).toBe(19);
    const p = canaryPush('abc1234', { passed: 16, total: 20 }, '16/20 now, 20/20 on zzz', ['price:vi', 'group:en']);
    expect(p.title).toContain('16/20');
    expect(p.body).toContain('price:vi');
  });
});
