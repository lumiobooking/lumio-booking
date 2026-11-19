import { customerPhoneFrom, phoneIn, phoneKeyOf, prospectDays, prospectPhone } from './prospects';
import { ChatTurnsService } from './chat-turns.service';
import { logRowsFrom } from './message-log';

describe('rt215 — a phone number the customer left', () => {
  it('reads Vietnamese and US numbers, not prices or dates', () => {
    expect(phoneIn('sđt em 0912 345 678 nha')).toBe('0912345678');
    expect(phoneIn('+84 912-345-678')).toBe('0912345678');
    expect(phoneIn('(714) 555-0199')).toBe('7145550199');
    expect(phoneIn('giá 1.500.000.000đ')).toBeNull();
    expect(phoneIn('ngày 19/11/2026 lúc 15h')).toBeNull();
    expect(phoneIn('250k')).toBeNull();
  });

  it('only the customer’s own lines count — never the salon’s number in a reply', () => {
    expect(customerPhoneFrom([
      { role: 'assistant', content: 'Hotline tiệm 0909 111 222 ạ' },
      { role: 'user', content: 'Ok em' },
    ])).toBeNull();
    expect(customerPhoneFrom([{ role: 'user', content: 'Gọi 0987.654.321 nhé' }])).toBe('0987654321');
  });

  it('the same number written two ways is one customer', () => {
    expect(phoneKeyOf('0912345678')).toBe(phoneKeyOf('+84 912 345 678'));
  });

  it('booked, won or lost is not a prospect; a saved number wins over a typed one', () => {
    const base = { threadId: 't', phoneTyped: '0912345678', phoneSaved: null, leadStatus: null, booked: false };
    expect(prospectPhone(base)).toBe('0912345678');
    expect(prospectPhone({ ...base, booked: true })).toBeNull();
    expect(prospectPhone({ ...base, leadStatus: 'WON' })).toBeNull();
    expect(prospectPhone({ ...base, leadStatus: 'LOST' })).toBeNull();
    expect(prospectPhone({ ...base, phoneSaved: '0900000001' })).toBe('0900000001');
    expect(prospectDays(7)).toBe(90);
    expect(prospectDays(365)).toBe(365);
  });
});

describe('rt215 — the Page’s robots are not a person answering', () => {
  it('Meta AI and the Page’s automation are named in the log; a person from Meta’s inbox is not', () => {
    const rows = logRowsFrom('A', 't1', [
      { role: 'assistant', content: 'Meta trả lời', at: '2026-11-19T10:00:00Z', source: 'meta-ai' },
      { role: 'assistant', content: 'Chào bạn!', at: '2026-11-19T10:00:01Z', source: 'automation' },
      { role: 'assistant', content: 'Mình là Trang', at: '2026-11-19T10:01:00Z', source: 'page', manual: true },
    ]);
    expect(rows.map((r) => r.byName)).toEqual(['Meta AI', 'Tự động (Page)', null]);
  });
});

/** One conversation held by Trang at salon A. Logs of who wrote what live in `msgs`. */
function held(opts: { hops?: number; repliedMinsAgo?: number | null; assignedMinsAgo?: number } = {}) {
  const now = Date.now();
  const t = { id: 't1', tenantId: 'A', status: 'open', assignedUserId: 'trang', assignedAt: new Date(now - (opts.assignedMinsAgo ?? 60) * 60_000), assignHops: opts.hops ?? 0, senderName: 'Viet Nguyen' };
  const msgs = opts.repliedMinsAgo == null ? [] : [{ threadId: 't1', _max: { at: new Date(now - opts.repliedMinsAgo * 60_000) } }];
  const logs: Record<string, unknown>[] = [];
  const pushed: string[] = [];
  const prisma = {
    messengerConnection: { findUnique: jest.fn(async () => ({ chatAssignMode: 'round-robin', chatReassignUnrepliedMins: 5 })) },
    messengerThread: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === t.id && where.tenantId === t.tenantId ? t : null)),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; tenantId: string; assignedAt?: Date }; data: Record<string, unknown> }) => {
        if (where.id !== t.id || where.tenantId !== t.tenantId) return { count: 0 };
        if (where.assignedAt && where.assignedAt.getTime() !== t.assignedAt.getTime()) return { count: 0 };
        Object.assign(t, data); return { count: 1 };
      }),
    },
    messengerMessageLog: { groupBy: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' ? msgs : [])) },
    chatAssignmentLog: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { logs.push(data); return {}; }) },
  };
  const push = { sendToUser: jest.fn(async (_t: string, uid: string) => { pushed.push(uid); return 1; }) };
  const svc = new ChatTurnsService(prisma as never, { publish: jest.fn() } as never, push as never);
  return { svc, t, logs, pushed, prisma };
}

describe('rt215 — a customer writing again starts a new turn', () => {
  it('the holder had answered: the clock and the passes restart, and they are told', async () => {
    const { svc, t, logs, pushed } = held({ hops: 3, repliedMinsAgo: 30 });
    const now = new Date();
    expect(await svc.noteCustomer('A', 't1', now)).toBe(true);
    expect(t.assignedAt).toEqual(now);
    expect(t.assignHops).toBe(0);
    expect(logs[0]).toMatchObject({ reason: 'customer-back', userId: 'trang' });
    expect(pushed).toEqual(['trang']);
  });

  it('the holder has not answered yet: the running turn keeps its clock', async () => {
    const { svc, t } = held({ repliedMinsAgo: null, assignedMinsAgo: 2 });
    const before = t.assignedAt;
    expect(await svc.noteCustomer('A', 't1')).toBe(false);
    expect(t.assignedAt).toBe(before);
  });

  it('an answer from before this turn does not count', async () => {
    const { svc } = held({ repliedMinsAgo: 120, assignedMinsAgo: 60 });
    expect(await svc.noteCustomer('A', 't1')).toBe(false);
  });

  it('an old customer given out to follow up who writes back becomes a live turn', async () => {
    const { svc, t } = held({ hops: 99, repliedMinsAgo: null });
    expect(await svc.noteCustomer('A', 't1')).toBe(true);
    expect(t.assignHops).toBe(0);
  });

  it('another salon cannot restart this salon’s turn', async () => {
    const { svc, t } = held({ hops: 3, repliedMinsAgo: 30 });
    expect(await svc.noteCustomer('B', 't1')).toBe(false);
    expect(t.assignHops).toBe(3);
  });

  it('“replied” is a person’s reply from the log, not handoffAt', async () => {
    const { svc, prisma } = held({ repliedMinsAgo: null });
    const rows = [{ id: 't1', handoffAt: new Date() as Date | null }];
    await (svc as unknown as { withHumanReply: (t: string, r: unknown[]) => Promise<unknown> }).withHumanReply('A', rows);
    expect(rows[0].handoffAt).toBeNull();
    expect(prisma.messengerMessageLog.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'A', OR: [{ role: 'staff' }, { role: 'page', byName: null }] }) }));
  });
});

describe('rt215 — giving prospects out', () => {
  it('only the owner; staff are refused', async () => {
    const svc = new ChatTurnsService({} as never, { publish: jest.fn() } as never);
    await expect(svc.giveOut({ userId: 'lan', role: 'STAFF', tenantId: 'A' } as never, ['t1'], { reason: 'prospect', title: '', body: () => '', audit: 'x' })).rejects.toThrow();
  });
});
