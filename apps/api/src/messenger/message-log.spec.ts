import { fingerprint, historyWrite, logRowsFrom, roleOf } from './message-log';
import { MessengerService } from './messenger.service';

describe('rt204 — the permanent message log', () => {
  const hist = [
    { role: 'user', content: 'Giá gel bao nhiêu?', at: '2026-11-19T10:00:00Z' },
    { role: 'assistant', content: 'Dạ gel 250k ạ', at: '2026-11-19T10:00:20Z' },
    { role: 'assistant', content: 'Chị qua lúc 3h nhé', at: '2026-11-19T10:05:00Z', manual: true, by: 'Lan', messageId: 'm_1' },
    { role: 'assistant', content: 'Tin từ Business Suite', at: '2026-11-19T10:06:00Z', source: 'page', manual: true },
    { role: 'assistant', content: '', at: '2026-11-19T10:07:00Z' },
    { role: 'user', content: 'không có giờ' },
  ];

  it('says who wrote each message', () => {
    expect(hist.slice(0, 4).map((t) => roleOf(t))).toEqual(['customer', 'ai', 'staff', 'page']);
  });

  it('turns a history into rows: names kept for staff, empty and clockless lines skipped', () => {
    const rows = logRowsFrom('A', 't1', hist);
    expect(rows.map((r) => r.role)).toEqual(['customer', 'ai', 'staff', 'page']);
    expect(rows[2]).toMatchObject({ tenantId: 'A', threadId: 't1', byName: 'Lan', messageId: 'm_1' });
    expect(rows.every((r) => r.tenantId === 'A')).toBe(true);
  });

  it('the same message is the same row; another conversation or salon is another', () => {
    const a = logRowsFrom('A', 't1', hist)[0].fp;
    expect(logRowsFrom('A', 't1', hist)[0].fp).toBe(a);
    expect(logRowsFrom('A', 't2', hist)[0].fp).not.toBe(a);
    expect(fingerprint('t1', 'customer', '2026-11-19T10:00:00.000Z', 'Giá gel bao nhiêu?')).toBe(a);
  });

  it('spots every way a thread history is written', () => {
    expect(historyWrite({ model: 'MessengerThread', action: 'update', args: { data: { history: [] } } })).toEqual([]);
    expect(historyWrite({ model: 'MessengerThread', action: 'updateMany', args: { data: { history: [1] } } })).toEqual([1]);
    expect(historyWrite({ model: 'MessengerThread', action: 'upsert', args: { update: { history: [2] } } })).toEqual([2]);
    expect(historyWrite({ model: 'MessengerThread', action: 'update', args: { data: { status: 'done' } } })).toBeNull();
    expect(historyWrite({ model: 'Customer', action: 'update', args: { data: { history: [] } } })).toBeNull();
  });
});

describe('rt204 — the record is the owner’s, and only of their own salon', () => {
  function fake() {
    const prisma = {
      messengerThread: { findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === 'tA' && where.tenantId === 'A' ? { id: 'tA', senderName: 'Ngọc' } : null)) },
      messengerMessageLog: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' ? [{ role: 'staff', byName: 'Lan', content: 'Đã xoá trên Meta nhưng vẫn còn đây', at: new Date() }] : [])) },
      auditLog: { findMany: jest.fn(async () => [{ action: 'messenger.manual_send', userId: 'lan', metadata: null, createdAt: new Date() }]) },
      chatAssignmentLog: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async () => [{ id: 'lan', firstName: 'Lan', lastName: null }]) },
    };
    const self = { prisma, tenantId: (u: { tenantId: string }) => u.tenantId, audit: jest.fn(async () => undefined) };
    const call = (user: unknown, id: string) => (MessengerService.prototype.threadRecord as unknown as (this: unknown, u: unknown, i: string) => Promise<{ messages: unknown[]; actions: { who: string | null }[] }>).call(self, user, id);
    return { call, self };
  }

  it('the owner sees every message and who acted', async () => {
    const { call, self } = fake();
    const r = await call({ userId: 'o', role: 'SALON_ADMIN', tenantId: 'A' }, 'tA');
    expect(r.messages).toHaveLength(1);
    expect(r.actions[0].who).toBe('Lan');
    expect(self.audit).toHaveBeenCalledWith('A', 'messenger.record_viewed', expect.objectContaining({ threadId: 'tA' }));
  });

  it('staff cannot open it; another salon cannot reach this conversation', async () => {
    const { call } = fake();
    await expect(call({ userId: 'lan', role: 'STAFF', tenantId: 'A' }, 'tA')).rejects.toThrow();
    await expect(call({ userId: 'o', role: 'SALON_ADMIN', tenantId: 'B' }, 'tA')).rejects.toThrow();
  });
});

describe('rt204 — every history write lands in the log', () => {
  it('records the newest turns after the write, under the thread’s own salon', async () => {
    const { PrismaService } = await import('../prisma/prisma.service');
    const created: unknown[] = [];
    const self = {
      messengerThread: { findUnique: jest.fn(async () => ({ tenantId: 'A' })) },
      messengerMessageLog: { createMany: jest.fn(async (a: { data: unknown[] }) => { created.push(...a.data); }) },
    };
    const run = (PrismaService.prototype as unknown as { logHistory: (this: unknown, p: unknown, r: unknown) => void }).logHistory;
    run.call(self, { model: 'MessengerThread', action: 'updateMany', args: { where: { id: 't1' }, data: { history: [{ role: 'user', content: 'Chào', at: '2026-11-19T10:00:00Z' }] } } }, { count: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(created).toEqual([expect.objectContaining({ tenantId: 'A', threadId: 't1', role: 'customer', content: 'Chào' })]);
    // Not a history write: nothing logged.
    run.call(self, { model: 'MessengerThread', action: 'update', args: { where: { id: 't1' }, data: { status: 'done' } } }, { id: 't1', tenantId: 'A' });
    await new Promise((r) => setTimeout(r, 20));
    expect(created).toHaveLength(1);
  });
});
