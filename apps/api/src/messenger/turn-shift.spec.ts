import { cleanShift, remindDue, rescueOpen, shiftActive, shiftExpired, shiftKey, shiftUntil } from './turn-shift';
import { ChatTurnsService } from './chat-turns.service';

const now = new Date('2026-11-19T03:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe('rt198 — Vào ca / Ra ca rules', () => {
  it('a shift is on until Ra ca or until it runs out', () => {
    const s = cleanShift({ on: true, at: ago(60).toISOString(), until: new Date(now.getTime() + 3600_000).toISOString() })!;
    expect(shiftActive(s, now)).toBe(true);
    expect(shiftActive({ ...s, on: false }, now)).toBe(false);
    expect(shiftActive({ ...s, until: ago(1).toISOString() }, now)).toBe(false);
    expect(shiftExpired({ ...s, until: ago(1).toISOString() }, now)).toBe(true);
    expect(cleanShift({ on: true })).toBeNull();
  });

  it('ends 30 minutes after today’s hours, else after 12 hours', () => {
    const hours = [{ dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true }];
    // 10:00 on Thursday: 18:30 is 8.5 hours away.
    expect(shiftUntil(now, { weekday: 4, minutes: 600 }, hours).getTime() - now.getTime()).toBe(8.5 * 3600_000);
    // After 18:30, or on a day off, or with no hours: 12 hours.
    expect(shiftUntil(now, { weekday: 4, minutes: 19 * 60 }, hours).getTime() - now.getTime()).toBe(12 * 3600_000);
    expect(shiftUntil(now, { weekday: 0, minutes: 600 }, hours).getTime() - now.getTime()).toBe(12 * 3600_000);
    expect(shiftUntil(now, null, []).getTime() - now.getTime()).toBe(12 * 3600_000);
  });

  it('rings a second time once, a minute after the turn, when nobody opened it', () => {
    const t = { status: 'open', assignedUserId: 'lan', assignedAt: ago(70), readAt: null, handoffAt: null };
    expect(remindDue(t, now)).toBe(true);
    expect(remindDue({ ...t, assignedAt: ago(30) }, now)).toBe(false);
    expect(remindDue({ ...t, assignedAt: ago(130) }, now)).toBe(false);
    expect(remindDue({ ...t, readAt: ago(10) }, now)).toBe(false);
    expect(remindDue({ ...t, handoffAt: ago(10) }, now)).toBe(false);
    // Read before the turn came to this person does not count as opened.
    expect(remindDue({ ...t, readAt: ago(600) }, now)).toBe(true);
  });

  it('a customer left waiting past the alarm is open to the whole team, until someone answers', () => {
    expect(rescueOpen({ escalatedAt: ago(10), lastCustomerAt: ago(700), handoffAt: null })).toBe(true);
    expect(rescueOpen({ escalatedAt: ago(10), lastCustomerAt: ago(700), handoffAt: ago(5) })).toBe(false);
    expect(rescueOpen({ escalatedAt: ago(800), lastCustomerAt: ago(700) })).toBe(false);
    expect(rescueOpen({ escalatedAt: null, lastCustomerAt: ago(700) })).toBe(false);
  });
});

/** Two salons: Lan works at A, Bảo at B. In-memory settings and presence. */
function setup() {
  const settings = new Map<string, unknown>();
  const presence = new Map<string, { status: string; lastSeenAt: Date }>();
  const users = [{ id: 'lan', tenantId: 'A', firstName: 'Lan' }, { id: 'bao', tenantId: 'B', firstName: 'Bảo' }];
  const audit: { tenantId: string; action: string; userId?: string }[] = [];
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    messengerConnection: { findUnique: jest.fn(async () => ({ chatAssignMode: 'round-robin', chatNeedOnline: true, chatOnlineMins: 10 })) },
    user: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => { const u = users.find((x) => x.id === where.id && x.tenantId === where.tenantId); return u ? { id: u.id, staffMember: null } : null; }),
      findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => users.filter((u) => u.tenantId === where.tenantId).map((u) => ({ ...u, lastName: null, email: `${u.id}@x`, role: 'STAFF', staffMember: { isActive: true, staffRole: 'CHAT', permissions: null, workingHours: [] } }))),
    },
    setting: {
      findMany: jest.fn(async ({ where }: { where: { tenantId: string; key: { startsWith: string } } }) => [...settings.entries()].filter(([k]) => k.startsWith(`${where.tenantId}|${where.key.startsWith}`)).map(([k, value]) => ({ key: k.split('|')[1], value }))),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => { settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {}; }),
    },
    chatAgentPresence: {
      findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => [...presence.entries()].filter(([k]) => k.startsWith(`${where.tenantId}|`)).map(([k, v]) => ({ userId: k.split('|')[1], ...v }))),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_userId: { tenantId: string; userId: string } }; create: { status: string; lastSeenAt: Date } }) => { presence.set(`${where.tenantId_userId.tenantId}|${where.tenantId_userId.userId}`, { status: create.status, lastSeenAt: create.lastSeenAt }); return {}; }),
    },
    messengerThread: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    chatAssignmentLog: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    messengerPage: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async ({ data }: { data: { tenantId: string; action: string } }) => { audit.push(data); return {}; }) },
  };
  const pushed: { tenantId: string; userId: string; title: string }[] = [];
  const push = { enabled: () => true, countForUser: jest.fn(async () => ({ web: 1, native: 0 })), sendToUser: jest.fn(async (tenantId: string, userId: string, p: { title: string }) => { pushed.push({ tenantId, userId, title: p.title }); return 1; }) };
  const svc = new ChatTurnsService(prisma as never, { publish: jest.fn() } as never, push as never);
  return { svc, settings, presence, audit, pushed };
}
const lan = { userId: 'lan', role: 'STAFF', tenantId: 'A' } as never;
const bao = { userId: 'bao', role: 'STAFF', tenantId: 'B' } as never;

describe('rt198 — one salon at a time', () => {
  it('Vào ca makes a person present with the app closed; Ra ca takes them out', async () => {
    const { svc, settings, audit } = setup();
    const r = await svc.setShift(lan, true);
    expect(r.on).toBe(true);
    expect(settings.has(`A|${shiftKey('lan')}`)).toBe(true);
    expect(settings.has(`B|${shiftKey('lan')}`)).toBe(false);
    // No heartbeat for an hour: still on duty because the shift is on.
    const later = await svc.agents('A');
    expect(later.find((a) => a.userId === 'lan')).toMatchObject({ shiftOn: true, onDuty: true });
    await svc.setShift(lan, false);
    expect((await svc.agents('A')).find((a) => a.userId === 'lan')).toMatchObject({ shiftOn: false, status: 'away', onDuty: false });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['messenger.turn_shift_on', 'messenger.turn_shift_off']));
  });

  it('one salon’s shift never shows in another salon', async () => {
    const { svc } = setup();
    await svc.setShift(lan, true);
    const b = await svc.agents('B');
    expect(b.map((a) => a.userId)).toEqual(['bao']);
    expect(b[0].shiftOn).toBe(false);
  });

  it('nobody can open a shift for someone of another salon', async () => {
    const { svc, settings } = setup();
    await expect(svc.writeShift('A', 'bao', true)).rejects.toThrow();
    expect([...settings.keys()].some((k) => k.includes('bao'))).toBe(false);
    await svc.setShift(bao, true);
    expect(settings.has(`B|${shiftKey('bao')}`)).toBe(true);
    expect(settings.has(`A|${shiftKey('bao')}`)).toBe(false);
  });

  it('a shift that ran out is closed by the minute, and the person is told', async () => {
    const { svc, settings, pushed } = setup();
    settings.set(`A|${shiftKey('lan')}`, { on: true, at: ago(13 * 3600).toISOString(), until: ago(60).toISOString() });
    await (svc as unknown as { closeShifts(t: string, n: Date): Promise<number> }).closeShifts('A', now);
    expect((settings.get(`A|${shiftKey('lan')}`) as { on: boolean }).on).toBe(false);
    expect(pushed).toEqual([expect.objectContaining({ tenantId: 'A', userId: 'lan', title: 'Đã tự ra ca' })]);
  });

  it('the owner sees who will hear a customer; staff see only their own phones', async () => {
    const { svc } = setup();
    const v = await svc.view(lan);
    expect(v.agents.find((a) => a.userId === 'lan')?.devices).toBe(1);
    expect(v.pushOn).toBe(true);
  });
});
