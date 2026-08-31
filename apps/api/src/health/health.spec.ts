import * as fs from 'fs';
import * as path from 'path';
import { HealthController } from './health.controller';

/**
 * A liveness probe must answer. Always, quickly, whatever the database is doing.
 *
 * The failure that prompted these: a deploy was rejected with "Timed out after
 * waiting for internal health check to return a successful response code",
 * while the application itself had started cleanly and was serving. The check
 * awaited `SELECT 1` with no bound — so a database that was slow rather than
 * broken did not make the check fail, it made the check never reply. The host
 * cannot tell those apart, and threw away a working process.
 *
 * The rule these lock in: this endpoint reports on THIS PROCESS. The database
 * is a field in the answer, never a condition of it.
 */

const prismaWith = (impl: () => Promise<unknown>) =>
  ({ $queryRaw: impl } as unknown as ConstructorParameters<typeof HealthController>[0]);

describe('the probe answers no matter what the database does', () => {
  it('reports up when the query returns', async () => {
    const c = new HealthController(prismaWith(async () => [{ '?column?': 1 }]));
    const r = await c.check();
    expect(r.status).toBe('ok');
    expect(r.database).toBe('up');
  });

  it('reports down — and still answers — when the query throws', async () => {
    const c = new HealthController(prismaWith(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await c.check();
    expect(r.status).toBe('ok');
    expect(r.database).toBe('down');
  });

  it('gives up waiting on a hanging database instead of hanging with it', async () => {
    // The exact shape of the outage that killed the deploy: a query that never
    // settles. Before the timeout this test would never finish either.
    const c = new HealthController(prismaWith(() => new Promise(() => undefined)));
    const started = Date.now();
    const r = await c.check();
    expect(r.database).toBe('slow');
    expect(r.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(4000);
  }, 8000);

  it('separates the process from its database — three states, not two', async () => {
    // 'down' and 'slow' need different reactions: one is broken, the other is
    // waking up. Collapsing them loses the distinction that matters at boot.
    const states = await Promise.all([
      new HealthController(prismaWith(async () => 1)).check(),
      new HealthController(prismaWith(async () => { throw new Error('x'); })).check(),
      new HealthController(prismaWith(() => new Promise(() => undefined))).check(),
    ]);
    expect(states.map((s) => s.database)).toEqual(['up', 'down', 'slow']);
    // Whatever the database said, the process reported itself alive.
    expect(states.every((s) => s.status === 'ok')).toBe(true);
  }, 8000);

  it('never leaks the connection string, only a fingerprint', async () => {
    process.env.DATABASE_URL = 'postgres://user:hunter2@host/db';
    const r = await new HealthController(prismaWith(async () => 1)).check();
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(r.db).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('the server binds every interface', () => {
  it('passes a host to listen, so a probe cannot arrive on an unbound one', () => {
    // Without a host, Node's default varies with the platform's IPv6 setup, and
    // a probe on the wrong interface looks like a timeout rather than a refusal.
    const main = fs.readFileSync(path.join(__dirname, '../main.ts'), 'utf8');
    expect(main).toMatch(/app\.listen\(\s*port\s*,\s*'0\.0\.0\.0'\s*\)/);
  });
});
