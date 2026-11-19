import { recordTiming, routeKey, timingReport } from './request-timing';

describe('rt222 — request timings on /api/health', () => {
  it('keys by route pattern only — no ids, no query', () => {
    expect(routeKey('get', '', '/api/messenger/threads/:id')).toBe('GET /api/messenger/threads/:id');
    expect(routeKey('POST', undefined, undefined)).toBe('POST (unmatched)');
  });

  it('reports the slowest routes of the last 10 minutes and drops older samples', () => {
    const now = Date.now();
    recordTiming('GET /old', 9000, 200, now - 11 * 60_000);
    for (let i = 0; i < 10; i += 1) recordTiming('GET /fast', 20, 200, now);
    recordTiming('GET /slow', 7000, 200, now);
    const r = timingReport(now);
    expect(r.slowest[0]).toMatchObject({ route: 'GET /slow', max: 7000 });
    expect(r.slowest.find((x) => x.route === 'GET /old')).toBeUndefined();
    expect(r.over6s10m).toBe(1);
    expect(r.eventLoopDelayMs).toHaveProperty('p99');
  });
});
