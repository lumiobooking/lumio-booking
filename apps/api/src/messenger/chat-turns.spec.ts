import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatTurnsService, settingsOf } from './chat-turns.service';

/**
 * Chat turns across salons. The rules are pure (chat-assignment.spec); this
 * file is about the walls: one salon can never move another salon's
 * conversation, hand a conversation to another salon's staff, or put another
 * salon's people in its queue.
 */
const A = 'tenant-a';
const B = 'tenant-b';

function makePrisma() {
  const threads = [
    { id: 't-a', tenantId: A, assignedUserId: null as string | null },
    { id: 't-a-mine', tenantId: A, assignedUserId: 'u-a-staff' },
    { id: 't-a-hers', tenantId: A, assignedUserId: 'u-a-other' },
    { id: 't-b', tenantId: B, assignedUserId: null },
  ];
  const users = [
    { id: 'u-a-admin', tenantId: A, role: 'SALON_ADMIN', isActive: true },
    { id: 'u-a-staff', tenantId: A, role: 'STAFF', isActive: true },
    { id: 'u-a-other', tenantId: A, role: 'STAFF', isActive: true },
    { id: 'u-b-staff', tenantId: B, role: 'STAFF', isActive: true },
  ];
  const logs: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const connUpdates: Record<string, unknown>[] = [];
  const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
      return row[k] === v;
    });
  return {
    logs, updates, connUpdates,
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'America/New_York' })) },
    messengerThread: {
      findFirst: jest.fn(async ({ where }: any) => threads.find((t) => match(t, where)) ?? null),
      updateMany: jest.fn(async (a: any) => { updates.push(a); return { count: 1 }; }),
      groupBy: jest.fn(async () => []),
    },
    user: {
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id && u.tenantId === where.tenantId && u.isActive) ?? null),
      findMany: jest.fn(async ({ where }: any) => users.filter((u) => u.tenantId === where.tenantId && (!where.id || where.id.in.includes(u.id)))),
    },
    messengerConnection: {
      findUnique: jest.fn(async ({ where }: any) => ({ tenantId: where.tenantId, chatAssignMode: 'round-robin' })),
      update: jest.fn(async (a: any) => { connUpdates.push(a); return {}; }),
    },
    chatAssignmentLog: { create: jest.fn(async ({ data }: any) => { logs.push(data); return data; }), findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
    chatAgentPresence: { findMany: jest.fn(async () => []), upsert: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
}

const events = { publish: jest.fn() };
const admin = { userId: 'u-a-admin', tenantId: A, role: 'SALON_ADMIN' } as any;
const staff = { userId: 'u-a-staff', tenantId: A, role: 'STAFF' } as any;

describe('chat turns never cross salons', () => {
  it("cannot move another salon's conversation — it is simply not found", async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await expect(svc.assign(admin, 't-b', 'u-a-staff')).rejects.toBeInstanceOf(NotFoundException);
    expect(p.updates).toHaveLength(0);
  });

  it("cannot hand a conversation to another salon's staff", async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await expect(svc.assign(admin, 't-a', 'u-b-staff')).rejects.toBeInstanceOf(BadRequestException);
    expect(p.updates).toHaveLength(0);
  });

  it('hands it to a teammate and logs who, from whom and by whom — all under the salon', async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await svc.assign(admin, 't-a-hers', 'u-a-staff');
    expect(p.updates[0]).toMatchObject({ where: { id: 't-a-hers', tenantId: A }, data: { assignedUserId: 'u-a-staff' } });
    expect(p.logs[0]).toMatchObject({ tenantId: A, threadId: 't-a-hers', userId: 'u-a-staff', fromUserId: 'u-a-other', byUserId: 'u-a-admin', reason: 'manual' });
  });

  it("does not let a staff member take a colleague's conversation", async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await expect(svc.assign(staff, 't-a-hers', 'u-a-staff')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a staff member pass on their own conversation', async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await svc.assign(staff, 't-a-mine', 'u-a-other');
    expect(p.logs[0]).toMatchObject({ tenantId: A, userId: 'u-a-other', reason: 'manual' });
  });

  it("keeps another salon's people out of the queue even if their ids are sent", async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await svc.updateSettings(admin, { agentIds: ['u-a-staff', 'u-b-staff'] });
    const written = p.connUpdates.find((u: any) => u.data?.chatAgentIds);
    expect((written as any).where).toEqual({ tenantId: A });
    expect((written as any).data.chatAgentIds).toEqual(['u-a-staff']);
  });

  it('only the salon admin may change the rules', async () => {
    const p = makePrisma();
    const svc = new ChatTurnsService(p as any, events as any);
    await expect(svc.updateSettings(staff, { mode: 'off' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('turn settings defaults', () => {
  it('reads an old row as: off, strict turns, bot answers first, all three duty tests on', () => {
    expect(settingsOf({})).toMatchObject({ mode: 'off', rotation: 'strict', botFirst: true, needStatus: true, needShift: true, needOnline: true, reassignUnreadMins: 0, reassignUnrepliedMins: 0, agentIds: [] });
  });
});
