/**
 * "Connect Facebook / Zalo / TikTok / Gmail / Google" can no longer be
 * finished by someone else: the provider's answer is parked at the callback
 * and applied only from a signed-in session of the salon that started it.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' } };
});
jest.mock('../messenger/messenger.service', () => ({ MessengerService: class {} }));
import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OAuthGate, OAUTH_GATE_TTL_MS, tenantOfState } from './oauth-gate.service';
import { MessengerWebhookController } from '../messenger/messenger-webhook.controller';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function store() {
  const rows: Row[] = [];
  const prisma: Row = {
    setting: {
      create: async ({ data }: Row) => { rows.push({ ...data, createdAt: new Date() }); return data; },
      deleteMany: async ({ where }: Row) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          const keyOk = typeof where.key === 'string' ? r.key === where.key : r.key.startsWith(where.key.startsWith);
          const ageOk = !where.createdAt || r.createdAt < where.createdAt.lt;
          if (r.tenantId === where.tenantId && keyOk && ageOk) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      findUnique: async ({ where }: Row) => rows.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key) ?? null,
    },
  };
  return { rows, gate: new OAuthGate(prisma as never, { log: async () => undefined } as never) };
}
const ownerA = { userId: 'ua', tenantId: 'A', role: 'SALON_ADMIN' } as never;
const ownerB = { userId: 'ub', tenantId: 'B', role: 'SALON_ADMIN' } as never;
const staffA = { userId: 'sa', tenantId: 'A', role: 'STAFF' } as never;
const pairOf = (url: string) => { const u = new URL(url); return { n: u.searchParams.get('n')!, c: u.searchParams.get('c')!, p: u.searchParams.get('p') }; };

describe('the gate', () => {
  it('nothing to park without a code or a salon', async () => {
    const { gate, rows } = store();
    expect(await gate.park('facebook', null, { code: 'x', state: 's' })).toBeNull();
    expect(await gate.park('facebook', 'A', { code: '', state: 's' })).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it('the salon that started it finishes it — once', async () => {
    const { gate } = store();
    const { n, c, p } = pairOf((await gate.park('zalo', 'A', { code: 'K', oa_id: 'oa', state: 'S' }))!);
    expect(p).toBe('zalo');
    expect(await gate.claim(ownerA, 'zalo', n, c)).toEqual({ code: 'K', oa_id: 'oa', state: 'S' });
    await expect(gate.claim(ownerA, 'zalo', n, c)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("another salon's owner (the tricked victim) cannot finish it, and the grant stays parked for nobody else", async () => {
    const { gate, rows } = store();
    const { n, c } = pairOf((await gate.park('facebook', 'A', { code: 'K', state: 'S' }))!);
    await expect(gate.claim(ownerB, 'facebook', n, c)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(1);
  });

  it('a wrong code, another provider, an old answer or a technician login are refused', async () => {
    const { gate, rows } = store();
    const a = pairOf((await gate.park('tiktok', 'A', { code: 'K', state: 'S' }))!);
    await expect(gate.claim(ownerA, 'tiktok', a.n, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    const b = pairOf((await gate.park('tiktok', 'A', { code: 'K', state: 'S' }))!);
    await expect(gate.claim(ownerA, 'gmail', b.n, b.c)).rejects.toBeInstanceOf(BadRequestException);
    const c = pairOf((await gate.park('google', 'A', { code: 'K', state: 'S' }))!);
    rows.find((r) => r.key === `oauth_gate:${c.n}`)!.value.at = Date.now() - OAUTH_GATE_TTL_MS - 1;
    await expect(gate.claim(ownerA, 'google', c.n, c.c)).rejects.toThrow(/hết hạn/);
    const d = pairOf((await gate.park('google', 'A', { code: 'K', state: 'S' }))!);
    await expect(gate.claim(staffA, 'google', d.n, d.c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads each provider's own state check", () => {
    expect(tenantOfState({ verifyState: (s: string) => (s === 'good' ? 'A' : null) }, 'good')).toBe('A');
    expect(tenantOfState({}, 'good')).toBeNull();
  });
});

describe('Facebook: the callback parks, the signed-in salon applies', () => {
  it('nothing is connected at the callback; the owner of that salon connects it', async () => {
    const { gate } = store();
    const applied: Row[] = [];
    const svc = {
      verifyState: (s: string) => (s === 'state-A' ? 'A' : null),
      oauthCallback: async (code: string, state: string) => { applied.push({ code, state }); return 'https://lumiobooking.com/salon/messenger?fb=connected'; },
    };
    const ctl = new MessengerWebhookController(svc as never, gate);
    let to = '';
    await ctl.oauthCallback('CODE', 'state-A', '', { redirect: (u: string) => { to = u; } } as never);
    expect(applied).toHaveLength(0);
    expect(to).toMatch(/\/oauth\/confirm\?p=facebook&n=.+&c=.+/);
    const { n, c } = pairOf(to);
    await expect(ctl.oauthConfirm(ownerB, { n, c })).rejects.toBeInstanceOf(BadRequestException);
    expect(applied).toHaveLength(0);
    expect(await ctl.oauthConfirm(ownerA, { n, c })).toEqual({ redirect: 'https://lumiobooking.com/salon/messenger?fb=connected' });
    expect(applied).toEqual([{ code: 'CODE', state: 'state-A' }]);
  });

  it('a refusal or a bad state is reported straight away, as before', async () => {
    const { gate } = store();
    const svc = { verifyState: () => null, oauthCallback: async () => 'https://lumiobooking.com/salon/messenger?fb=error' };
    const ctl = new MessengerWebhookController(svc as never, gate);
    let to = '';
    await ctl.oauthCallback('CODE', 'forged', '', { redirect: (u: string) => { to = u; } } as never);
    expect(to).toBe('https://lumiobooking.com/salon/messenger?fb=error');
  });
});
