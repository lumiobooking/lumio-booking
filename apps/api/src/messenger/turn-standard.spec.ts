import { STANDARD_SETTINGS, firstEnable, standardColumns } from './turn-standard';
import { ChatTurnsService } from './chat-turns.service';

describe('rt210 — the standard chat-turn setup', () => {
  it('fills every rule, leaving out what the owner sent in the same save', () => {
    const c = standardColumns({ reassignUnreadMins: 7 });
    expect(c.chatReassignUnreadMins).toBeUndefined();
    expect(c).toMatchObject({ chatRotation: 'strict', chatReassignUnrepliedMins: 5, chatReassignAdMins: 2, chatEscalateMins: 10, chatNeedShift: false, chatMaxOpenPerAgent: 10 });
  });

  it('only a first switch-on with no timers ever set starts from the standard', () => {
    const blank = { mode: 'off', reassignUnreadMins: 0, reassignUnrepliedMins: 0, reassignAdMins: 0, escalateMins: 0 };
    expect(firstEnable(blank, 'round-robin')).toBe(true);
    expect(firstEnable({ ...blank, reassignUnrepliedMins: 4 }, 'round-robin')).toBe(false);
    expect(firstEnable({ ...blank, mode: 'round-robin' }, 'round-robin')).toBe(false);
    expect(firstEnable(blank, 'off')).toBe(false);
  });
});

function setup() {
  const conns: Record<string, Record<string, unknown>> = { A: { tenantId: 'A', chatAssignMode: 'off', chatAgentIds: ['lan'] }, B: { tenantId: 'B', chatAssignMode: 'off', chatReassignUnreadMins: 9 } };
  const settings = new Map<string, unknown>([['A|messenger.turn_team', { members: { lan: { group: 'A', weight: 60, sources: [] } }, adCostCents: 50000 }]]);
  const prisma = {
    messengerConnection: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId: string } }) => conns[where.tenantId] ?? null),
      update: jest.fn(async ({ where, data }: { where: { tenantId: string }; data: Record<string, unknown> }) => { Object.assign(conns[where.tenantId], data); return conns[where.tenantId]; }),
    },
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => { const v = settings.get(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`); return v === undefined ? null : { value: v }; }),
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => { settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {}; }),
    },
    user: { findMany: jest.fn(async () => []) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    chatAgentPresence: { findMany: jest.fn(async () => []) },
    messengerThread: { groupBy: jest.fn(async () => []) },
    chatAssignmentLog: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    messengerPage: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { svc: new ChatTurnsService(prisma as never, { publish: jest.fn() } as never), conns, settings };
}
const ownerA = { userId: 'o', role: 'SALON_ADMIN', tenantId: 'A' } as never;

describe('rt210 — applied per salon, by the owner', () => {
  it('turning on for the first time starts from the standard; staff see only their own', async () => {
    const { svc, conns, settings } = setup();
    await svc.updateSettings(ownerA, { mode: 'round-robin' });
    expect(conns.A).toMatchObject({ chatAssignMode: 'round-robin', chatReassignUnreadMins: STANDARD_SETTINGS.reassignUnreadMins, chatEscalateMins: 10, chatAgentIds: ['lan'] });
    expect(settings.get('A|messenger.turn_team')).toMatchObject({ staffSeeAll: false, nightReport: true, adCostCents: 50000, members: { lan: expect.objectContaining({ weight: 60 }) } });
    expect(conns.B.chatAssignMode).toBe('off');
  });

  it('a salon with its own timers keeps them when it switches on', async () => {
    const { svc, conns } = setup();
    await svc.updateSettings({ userId: 'o', role: 'SALON_ADMIN', tenantId: 'B' } as never, { mode: 'round-robin' });
    expect(conns.B).toMatchObject({ chatAssignMode: 'round-robin', chatReassignUnreadMins: 9 });
    expect(conns.B.chatEscalateMins).toBeUndefined();
  });

  it('"Dùng cài đặt chuẩn" resets the rules, keeps who takes turns; staff cannot', async () => {
    const { svc, conns } = setup();
    conns.A.chatReassignUnreadMins = 30; conns.A.chatRotation = 'weighted';
    await svc.applyStandard(ownerA);
    expect(conns.A).toMatchObject({ chatReassignUnreadMins: 3, chatRotation: 'strict', chatAgentIds: ['lan'], chatAssignMode: 'off' });
    await expect(svc.applyStandard({ userId: 'lan', role: 'STAFF', tenantId: 'A' } as never)).rejects.toThrow();
    expect(conns.B.chatRotation).toBeUndefined();
  });
});
