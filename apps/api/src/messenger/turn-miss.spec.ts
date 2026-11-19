import { ChatTurnsService } from './chat-turns.service';

/** Two salons. Lan works at A (app closed, not on shift), Bảo at B. */
function setup(opts: { lanSeenMinsAgo?: number | null } = {}) {
  const now = Date.now();
  const threads = [
    { id: 'w1', tenantId: 'A', status: 'open', assignedUserId: null as string | null, customerId: null, senderName: 'Ngọc', lastCustomerAt: new Date(now - 60_000), lastMessageAt: new Date(now - 60_000) },
    { id: 'w2', tenantId: 'A', status: 'open', assignedUserId: null as string | null, customerId: null, senderName: 'Đã trả lời', lastCustomerAt: new Date(now - 600_000), lastMessageAt: new Date(now - 60_000) },
    { id: 'b1', tenantId: 'B', status: 'open', assignedUserId: null as string | null, customerId: null, senderName: 'Bảo khách', lastCustomerAt: new Date(now - 60_000), lastMessageAt: new Date(now - 60_000) },
  ];
  const logs: Record<string, unknown>[] = [];
  const seen = opts.lanSeenMinsAgo === null || opts.lanSeenMinsAgo === undefined ? null : new Date(now - opts.lanSeenMinsAgo * 60_000);
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    messengerConnection: { findUnique: jest.fn(async () => ({ chatAssignMode: 'round-robin' })), update: jest.fn(async () => ({})) },
    user: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' ? [{ id: 'lan', firstName: 'Lan', lastName: null, email: 'l@x', role: 'STAFF', staffMember: null }] : [{ id: 'bao', firstName: 'Bảo', lastName: null, email: 'b@x', role: 'STAFF', staffMember: null }])) },
    setting: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    chatAgentPresence: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' && seen ? [{ userId: 'lan', status: 'available', lastSeenAt: seen }] : [])) },
    messengerThread: {
      groupBy: jest.fn(async () => []),
      findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => threads.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null),
      findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => threads.filter((t) => t.tenantId === where.tenantId && !t.assignedUserId)),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; tenantId: string; assignedUserId?: null }; data: Record<string, unknown> }) => {
        const t = threads.find((x) => x.id === where.id && x.tenantId === where.tenantId && (where.assignedUserId === undefined || x.assignedUserId === null));
        if (t) Object.assign(t, data);
        return { count: t ? 1 : 0 };
      }),
    },
    chatAssignmentLog: { groupBy: jest.fn(async () => []), create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { logs.push(data); return {}; }) },
    messengerPage: { findMany: jest.fn(async () => []) },
  };
  const svc = new ChatTurnsService(prisma as never, { publish: jest.fn() } as never);
  return { svc, threads, logs };
}

describe('rt206 — why nobody got the customer, and giving out the ones waiting', () => {
  it('says why each person is not taking customers', async () => {
    const { svc } = setup({ lanSeenMinsAgo: null });
    const [lan] = await svc.agents('A');
    expect(lan.onDuty).toBe(false);
    expect(lan.blockers).toContain('not-present');
  });

  it('a customer nobody could take is remembered with the reason — per salon', async () => {
    const { svc } = setup({ lanSeenMinsAgo: null });
    expect(await svc.route('A', 'w1', null)).toBeNull();
    expect(svc.lastMiss('A')).toMatchObject({ why: 'nobody-on-duty', customer: 'Ngọc' });
    expect(svc.lastMiss('A')!.agents[0]).toMatchObject({ name: 'Lan', blockers: expect.arrayContaining(['not-present']) });
    expect(svc.lastMiss('B')).toBeNull();
  });

  it('customers who wrote last and wait with nobody are given out once someone is there — only in their salon', async () => {
    const { svc, threads } = setup({ lanSeenMinsAgo: 1 });
    expect(await svc.distributeWaiting('A')).toBe(1);
    expect(threads.find((t) => t.id === 'w1')!.assignedUserId).toBe('lan');
    // Someone already answered w2 after the customer: not "waiting".
    expect(threads.find((t) => t.id === 'w2')!.assignedUserId).toBeNull();
    expect(threads.find((t) => t.id === 'b1')!.assignedUserId).toBeNull();
  });

  it('a reply makes an unheld conversation the replier’s; a held one is never moved', async () => {
    const { svc, threads, logs } = setup();
    await svc.claimIfFree('A', 'w1', 'lan');
    expect(threads.find((t) => t.id === 'w1')!.assignedUserId).toBe('lan');
    expect(logs[0]).toMatchObject({ reason: 'took-by-reply', userId: 'lan' });
    await svc.claimIfFree('A', 'w1', 'minh');
    expect(threads.find((t) => t.id === 'w1')!.assignedUserId).toBe('lan');
    await svc.claimIfFree('B', 'w2', 'bao'); // another salon's id: nothing
    expect(threads.find((t) => t.id === 'w2')!.assignedUserId).toBeNull();
  });
});
