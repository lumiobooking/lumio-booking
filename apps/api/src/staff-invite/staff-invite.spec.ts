import { cleanInviteInput, facebookEmail, hashToken, inviteProblem, newToken, signState, signTicket, splitName, tokenShapeOk, verifyState, verifyTicket } from './staff-invite';
import { StaffInviteService } from './staff-invite.service';

const now = new Date('2026-11-19T09:00:00Z');

describe('rt200 — invite rules', () => {
  it('a token is random, stored only as its hash, and has one shape', () => {
    const a = newToken(); const b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(tokenShapeOk(a.token)).toBe(true);
    expect(tokenShapeOk('abc')).toBe(false);
    expect(tokenShapeOk("x' OR 1=1 --------------------------------")).toBe(false);
  });

  it('an invite works until revoked, expired or used up', () => {
    const inv = { maxUses: 2, uses: 1, expiresAt: new Date(now.getTime() + 1000), revokedAt: null };
    expect(inviteProblem(inv, now)).toBeNull();
    expect(inviteProblem({ ...inv, uses: 2 }, now)).toBe('used');
    expect(inviteProblem({ ...inv, revokedAt: now }, now)).toBe('revoked');
    expect(inviteProblem({ ...inv, expiresAt: now }, now)).toBe('expired');
    expect(inviteProblem(null, now)).toBe('missing');
  });

  it('never invites an owner; sensible limits', () => {
    expect(cleanInviteInput({ staffRole: 'SALON_ADMIN' }).staffRole).toBe('CHAT');
    expect(cleanInviteInput({ staffRole: 'RECEPTIONIST', maxUses: 99, days: 0 })).toMatchObject({ staffRole: 'RECEPTIONIST', maxUses: 20, days: 1 });
  });

  it('a hidden e-mail per salon and person, which can never be delivered', () => {
    expect(facebookEmail('1234', 'A')).not.toBe(facebookEmail('1234', 'B'));
    expect(facebookEmail('1234', 'A')).toMatch(/\.invalid$/);
    expect(splitName('Nguyễn Thị Lan')).toEqual({ firstName: 'Nguyễn Thị', lastName: 'Lan' });
    expect(splitName('')).toEqual({ firstName: 'Nhân viên', lastName: null });
  });

  it('state and ticket are signed and expire', () => {
    const s = signState({ m: 'join', i: 'h' }, now.getTime());
    expect(verifyState(s, now.getTime())?.i).toBe('h');
    expect(verifyState(s.slice(0, -2) + 'xx', now.getTime())).toBeNull();
    expect(verifyState(s, now.getTime() + 11 * 60_000)).toBeNull();
    const t = signTicket(['u1'], now.getTime());
    expect(verifyTicket(t, now.getTime())?.u).toEqual(['u1']);
    expect(verifyTicket(t, now.getTime() + 4 * 60_000)).toBeNull();
    // A state is not a ticket.
    expect(verifyTicket(s, now.getTime())).toBeNull();
  });
});

/** Two salons, in memory. */
function setup() {
  type Row = Record<string, any>;
  const db = { invites: [] as Row[], users: [{ id: 'ownerA', tenantId: 'A', role: 'SALON_ADMIN', isActive: true }, { id: 'ownerB', tenantId: 'B', role: 'SALON_ADMIN', isActive: true }] as Row[], staff: [] as Row[], logins: [] as Row[], audit: [] as Row[] };
  let seq = 0;
  const match = (r: Row, w: Row): boolean => Object.entries(w).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(r[k]);
      if ('lt' in v) return r[k] < v.lt;
      if ('gt' in v) return r[k] > v.gt;
    }
    return r[k] === v;
  });
  const prisma: Row = {
    staffInvite: {
      create: jest.fn(async ({ data }: Row) => { const r = { id: `inv${++seq}`, createdAt: new Date(), revokedAt: null, ...data }; db.invites.push(r); return r; }),
      findMany: jest.fn(async ({ where }: Row) => db.invites.filter((r) => match(r, where))),
      findUnique: jest.fn(async ({ where }: Row) => db.invites.find((r) => r.tokenHash === where.tokenHash) ?? null),
      updateMany: jest.fn(async ({ where, data }: Row) => { const rows = db.invites.filter((r) => match(r, where)); for (const r of rows) { if (data.uses?.increment) r.uses += data.uses.increment; else Object.assign(r, data); } return { count: rows.length }; }),
    },
    socialLogin: {
      findUnique: jest.fn(async ({ where }: Row) => { const k = where.provider_providerUserId_tenantId; return db.logins.find((r) => r.provider === k.provider && r.providerUserId === k.providerUserId && r.tenantId === k.tenantId) ?? null; }),
      findMany: jest.fn(async ({ where }: Row) => db.logins.filter((r) => match(r, where))),
      create: jest.fn(async ({ data }: Row) => { db.logins.push({ id: `sl${++seq}`, ...data }); return data; }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    user: {
      create: jest.fn(async ({ data }: Row) => { const r = { id: `u${++seq}`, isActive: true, ...data }; db.users.push(r); return r; }),
      findFirst: jest.fn(async ({ where }: Row) => db.users.find((r) => match(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: Row) => db.users.filter((r) => match(r, where))),
    },
    staffMember: { create: jest.fn(async ({ data }: Row) => { db.staff.push(data); return data; }) },
    tenant: { findUnique: jest.fn(async ({ where }: Row) => ({ name: where.id === 'A' ? 'Nail A' : 'Nail B' })), findMany: jest.fn(async ({ where }: Row) => (where.id.in as string[]).map((id) => ({ id, name: id === 'A' ? 'Nail A' : 'Nail B' }))) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  const audit = { log: jest.fn(async (x: Row) => { db.audit.push(x); }) };
  const auth = { sessionForUser: jest.fn(async (id: string) => ({ accessToken: `jwt-${id}`, user: { id } })) };
  process.env.FB_APP_ID = 'app';
  const svc = new StaffInviteService(prisma as never, audit as never, auth as never);
  return { svc, db, auth };
}
const ownerA = { userId: 'ownerA', role: 'SALON_ADMIN', tenantId: 'A' } as never;
const ownerB = { userId: 'ownerB', role: 'SALON_ADMIN', tenantId: 'B' } as never;
const tokenOf = (url: string) => url.split('/join/')[1];
const ticketOf = (url: string) => decodeURIComponent(url.split('t=')[1]);
const lan = { id: '1001', name: 'Trần Lan' };

describe('rt200 — one salon at a time', () => {
  it('a link puts the person in the salon that made it, with its role, and nowhere else', async () => {
    const { svc, db } = setup();
    const { url } = await svc.create(ownerA, { staffRole: 'CHAT' });
    expect((await svc.preview(tokenOf(url)))).toMatchObject({ ok: true, salonName: 'Nail A', role: 'CHAT' });
    const back = await svc.callback('code', signState({ m: 'join', i: hashToken(tokenOf(url)) }), '', lan);
    expect(back).toContain('/login/facebook?t=');
    const u = db.users.find((x) => x.firstName === 'Trần');
    expect(u).toMatchObject({ tenantId: 'A', role: 'STAFF' });
    expect(db.staff[0]).toMatchObject({ tenantId: 'A', staffRole: 'CHAT', takesAppointments: false, userId: u!.id });
    expect(db.logins[0]).toMatchObject({ tenantId: 'A', userId: u!.id, providerUserId: '1001' });
    expect(db.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['staff.invite_created', 'staff.joined_by_invite']));
  });

  it('a one-person link lets in one person; the same person again is just signed in', async () => {
    const { svc, db } = setup();
    const { url } = await svc.create(ownerA, { maxUses: 1 });
    const st = () => signState({ m: 'join', i: hashToken(tokenOf(url)) });
    await svc.callback('c', st(), '', lan);
    expect(await svc.callback('c', st(), '', lan)).toContain('/login/facebook?t=');
    expect(db.users.filter((x) => x.tenantId === 'A' && x.role === 'STAFF')).toHaveLength(1);
    expect(await svc.callback('c', st(), '', { id: '2002', name: 'Minh' })).toContain('fb=invite-used');
  });

  it('a revoked or expired link lets nobody in', async () => {
    const { svc, db } = setup();
    const { url, invite } = await svc.create(ownerA, {});
    await svc.revoke(ownerA, invite.id);
    expect(await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(url)) }), '', lan)).toContain('fb=invite-revoked');
    db.invites[0].revokedAt = null; db.invites[0].expiresAt = new Date(Date.now() - 1000);
    expect(await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(url)) }), '', lan)).toContain('fb=invite-expired');
    expect(db.users.some((x) => x.role === 'STAFF')).toBe(false);
  });

  it('one salon cannot see, revoke or use another salon’s invites; staff cannot invite', async () => {
    const { svc } = setup();
    const { invite } = await svc.create(ownerA, {});
    expect(await svc.list(ownerB)).toEqual([]);
    await expect(svc.revoke(ownerB, invite.id)).rejects.toThrow();
    await expect(svc.create({ userId: 'x', role: 'STAFF', tenantId: 'A' } as never, {})).rejects.toThrow();
  });

  it('a person in two salons has two logins and picks one; a forged or reused ticket fails', async () => {
    const { svc, auth } = setup();
    const a = await svc.create(ownerA, {}); const b = await svc.create(ownerB, {});
    await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(a.url)) }), '', lan);
    await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(b.url)) }), '', lan);
    const back = await svc.callback('c', signState({ m: 'login' }), '', lan);
    const t = ticketOf(back);
    const choose = await svc.exchange(t) as { choose: { i: number; salon: string }[] };
    expect(choose.choose.map((c) => c.salon).sort()).toEqual(['Nail A', 'Nail B']);
    const pickB = choose.choose.find((c) => c.salon === 'Nail B')!.i;
    await svc.exchange(t, pickB);
    expect(auth.sessionForUser).toHaveBeenCalledTimes(1);
    await expect(svc.exchange(t, pickB)).rejects.toThrow();
    await expect(svc.exchange(t.slice(0, -3) + 'abc')).rejects.toThrow();
  });

  it('a login the salon turned off cannot sign in, and an old link cannot turn it back on', async () => {
    const { svc, db } = setup();
    const { url } = await svc.create(ownerA, { maxUses: 5 });
    await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(url)) }), '', lan);
    db.users.find((x) => x.firstName === 'Trần')!.isActive = false;
    expect(await svc.callback('c', signState({ m: 'login' }), '', lan)).toContain('fb=none');
    expect(await svc.callback('c', signState({ m: 'join', i: hashToken(tokenOf(url)) }), '', lan)).toContain('fb=invite-revoked');
  });

  it('a state we did not sign is refused before Facebook is asked anything', async () => {
    const { svc } = setup();
    expect(await svc.callback('c', 'sl.forged.sig', '', lan)).toContain('fb=expired');
  });
});
