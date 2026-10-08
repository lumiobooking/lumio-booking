/**
 * An inbox that stays empty after the Page is connected: the chats from
 * before the connection are never replayed by the webhook, so they can be
 * pulled from the Page's /conversations edge instead — one thread each, the
 * customer's turns and the Page's, this salon's Page only. And the webhook
 * trace says whether Facebook has delivered anything at all.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;

function makeSvc() {
  const threads: Row[] = [];
  const prisma = {
    messengerPage: { findMany: async ({ where, distinct }: Row) => distinct ? [{ tenantId: 't1' }, { tenantId: 't2' }] : (where.tenantId === 't1' ? [{ pageId: 'p1', pageToken: 'TOK', pageName: 'Alamo Ranch' }] : []) },
    messengerConnection: { findUnique: async () => null },
    messengerThread: {
      findUnique: async ({ where }: Row) => threads.find((t) => where.pageId_senderId ? t.pageId === where.pageId_senderId.pageId && t.senderId === where.pageId_senderId.senderId : t.id === where.id) ?? null,
      create: async ({ data }: Row) => { const r = { id: `th${threads.length + 1}`, ...data }; threads.push(r); return r; },
      update: async ({ where, data }: Row) => { const t = threads.find((x) => x.id === where.id)!; Object.assign(t, data); return t; },
      count: async () => threads.length,
    },
    auditLog: { create: async () => ({}) },
  };
  const events = { publish: jest.fn() };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, events as never, {} as never);
  (svc as unknown as Row).audit = async () => undefined;
  const handled: Row[] = [];
  (svc as unknown as Row).handleMessage = async (pageId: string, senderId: string, text: string, ts: number) => { handled.push({ pageId, senderId, text, ts }); };
  return { svc, threads, events, handled };
}
const admin = { userId: 'u', tenantId: 't1', role: 'SALON_ADMIN' } as never;

describe('importing the Page’s recent conversations', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  it('creates one thread per conversation with the turns in order; a re-run adds nothing twice', async () => {
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ data: [
        { id: 'c1', participants: { data: [{ id: 'p1', name: 'Alamo Ranch' }, { id: 'u9', name: 'Maria Alvarado' }] },
          messages: { data: [
            { message: 'We also have a 15% discount', from: { id: 'p1' }, created_time: '2026-10-07T07:16:00+0000' },
            { message: 'Do you take walk-ins?', from: { id: 'u9', name: 'Maria Alvarado' }, created_time: '2026-10-07T07:15:00+0000' },
          ] } },
        { id: 'c2', participants: { data: [{ id: 'p1' }, { id: 'u8', name: 'Alma' }] }, messages: { data: [] } },
      ] }) };
    });
    const { svc, threads, events } = makeSvc();
    const r = await svc.importConversations(admin, 50);
    expect(r).toEqual({ imported: 1, updated: 0, skipped: 1, answered: 0, errors: [] });
    expect(urls[0]).toContain('/p1/conversations?platform=messenger');
    expect(threads[0]).toMatchObject({ tenantId: 't1', pageId: 'p1', senderId: 'u9', senderName: 'Maria Alvarado', lastText: 'We also have a 15% discount' });
    expect(threads[0].history.map((t: Row) => [t.role, t.content])).toEqual([['user', 'Do you take walk-ins?'], ['assistant', 'We also have a 15% discount']]);
    // The Page's own line (Meta's agent / a person in Business Suite) is never shown as the bot's.
    expect(threads[0].history[1]).toMatchObject({ manual: true, source: 'page' });
    expect(threads[0].lastCustomerAt.toISOString()).toBe('2026-10-07T07:15:00.000Z');
    expect(events.publish).toHaveBeenCalledWith('t1', 'message');
    const again = await svc.importConversations(admin, 50);
    expect(again).toEqual({ imported: 0, updated: 0, skipped: 2, answered: 0, errors: [] });
    expect(threads).toHaveLength(1);
    expect(threads[0].history).toHaveLength(2);
  });

  it('a customer line the webhook missed — unanswered for 45 s — is handed to the live path so the bot answers it', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [
      { id: 'c1', participants: { data: [{ id: 'p1' }, { id: 'u9', name: 'Maria' }] },
        messages: { data: [{ message: 'Do you have openings today?', from: { id: 'u9' }, created_time: old }] } },
      { id: 'c2', participants: { data: [{ id: 'p1' }, { id: 'u8', name: 'Alma' }] },
        messages: { data: [{ message: 'just now?', from: { id: 'u8' }, created_time: new Date().toISOString() }] } },
    ] }) }));
    const { svc, threads, handled } = makeSvc();
    const r = await svc.syncConversations('t1', { limit: 20 });
    // Maria: nothing written by the sync itself — handleMessage records and answers it.
    expect(handled).toEqual([{ pageId: 'p1', senderId: 'u9', text: 'Do you have openings today?', ts: new Date(old).getTime() }]);
    expect(r.answered).toBe(1);
    // Alma wrote seconds ago: the webhook is still expected to handle it; the sync only records it.
    expect(threads.find((t) => t.senderId === 'u8')).toBeTruthy();
    expect(handled.some((h) => h.senderId === 'u8')).toBe(false);
  });

  it('the sweep covers every salon with a Page and one salon’s failure does not stop the others', async () => {
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => { seen.push(String(url)); return { ok: true, json: async () => ({ data: [] }) }; });
    const { svc } = makeSvc();
    const r = await svc.syncAllConversations();
    // t2 has no Page row → "No Page connected" is counted as an error, t1 is polled.
    expect(r.salons).toBe(2);
    expect(r.errors).toBe(1);
    expect(seen.filter((u) => u.includes('/p1/conversations'))).toHaveLength(1);
    expect(seen[0]).toContain('messages.limit(5)');
  });

  it('a sweep only re-reads conversations Meta reports as updated since the last tick', async () => {
    let call = 0;
    (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [
      { id: 'c1', updated_time: '2026-10-08T01:00:00+0000', participants: { data: [{ id: 'p1' }, { id: 'u9', name: 'Maria' }] },
        messages: { data: [{ message: `hello ${++call}`, from: { id: 'u9' }, created_time: '2026-10-08T00:59:00+0000' }] } },
    ] }) }));
    const { svc, threads, handled } = makeSvc();
    await svc.syncConversations('t1', { incremental: true, reply: false });
    await svc.syncConversations('t1', { incremental: true, reply: false });
    // Second tick: same updated_time → skipped, nothing fetched into the thread twice.
    expect(threads).toHaveLength(1);
    expect(threads[0].history).toHaveLength(1);
    expect(handled).toHaveLength(0);
  });

  it('reports Meta’s reason instead of importing nothing silently; another salon has no Page here', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: '(#10) This endpoint requires the pages_messaging permission', code: 10 } }) }));
    const { svc, threads } = makeSvc();
    const r = await svc.importConversations(admin, 50);
    expect(r.imported).toBe(0);
    expect(r.errors[0]).toMatch(/pages_messaging/);
    expect(threads).toHaveLength(0);
    await expect(svc.importConversations({ userId: 'u2', tenantId: 't2', role: 'SALON_ADMIN' } as never, 50)).rejects.toThrow(/No Page connected/);
  });
});

describe('the webhook trace', () => {
  it('remembers the last lane Facebook used for each Page', async () => {
    const { svc } = makeSvc();
    const s = svc as unknown as Row;
    s.handleMessage = async () => undefined;
    s.takeThreadControl = async () => 'taken';
    await svc.handleWebhook({ object: 'page', entry: [
      { id: 'p1', messaging: [{ sender: { id: 'u1' }, recipient: { id: 'p1' }, message: { mid: 'a', text: 'hi' } }] },
      { id: 'p2', standby: [{ sender: { id: 'u2' }, recipient: { id: 'p2' }, message: { mid: 'b', text: 'hello there' } }] },
    ] });
    expect(svc.webhookTrace.get('p1')).toMatchObject({ count: 1, lane: 'messaging', preview: 'hi' });
    expect(svc.webhookTrace.get('p2')).toMatchObject({ count: 1, lane: 'standby', preview: 'hello there' });
  });
});
