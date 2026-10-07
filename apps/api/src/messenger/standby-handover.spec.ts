/**
 * "Other pages work, this one does not." The Page had Meta's Business Agent
 * switched on in Business Suite, so Meta's AI held every conversation and the
 * Page's messages reached our webhook under `standby`, which we ignored — the
 * inbox stayed empty while a second AI chatted with the salon's customers.
 * Also: with the bot switch OFF the message used to be dropped before the
 * inbox saw it; now it is recorded and the phones ring, only the reply waits
 * for a person.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;
const NOW = Date.now();

function makeSvc(opts: { botEnabled?: boolean; thread?: Row } = {}) {
  const thread: Row = opts.thread ?? { id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', senderName: 'Maria', handoff: false, history: [], status: 'open' };
  const appended: Row[][] = [];
  const queued: Row[] = [];
  const paused: Row[] = [];
  const events = { publish: jest.fn() };
  const push = { sendToTenant: jest.fn(async () => undefined) };
  const prisma = {
    messengerConnection: { findUnique: async () => ({ tenantId: 't1', enabled: opts.botEnabled ?? true, pageToken: 'TOK', aiInstruction: null, botFacts: [] }) },
    messengerThread: { upsert: async () => thread, update: async () => thread, findUnique: async () => thread },
    salesLead: { findFirst: async () => null },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago', market: 'US' }) },
  };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, events as never, push as never);
  const s = svc as unknown as Record<string, unknown>;
  s.pageByEntry = async () => ({ tenantId: 't1', pageId: 'p1', pageToken: 'TOK', enabled: true });
  s.fetchSenderName = async () => null;
  s.appendTurns = async (_id: string, _h: Row[], _m: unknown, turns: Row[]) => { appended.push(turns); thread.history = [...(thread.history ?? []), ...turns]; };
  s.queueReply = (_c: unknown, threadId: string, _s: string, text: string) => { queued.push({ threadId, text }); };
  s.pauseForHuman = async (entryId: string, customerId: string, text?: string) => { paused.push({ entryId, customerId, text }); };
  s.knownCustomerFor = async () => null;
  return { svc: s, appended, queued, paused, events, push };
}

describe('standby — another app holds the conversation', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  it('a customer line in standby is taken back and answered; the inbox sees it', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ success: true }) }; });
    const { svc, appended, queued } = makeSvc();
    await (svc.handleWebhook as (b: unknown) => Promise<void>).call(svc, {
      object: 'page',
      entry: [{ id: 'p1', standby: [{ sender: { id: 'u1' }, recipient: { id: 'p1' }, timestamp: NOW, message: { mid: 'm1', text: 'Do you have openings today?' } }] }],
    });
    expect(calls.some((u) => u.includes('/p1/take_thread_control'))).toBe(true);
    expect(appended[0][0]).toMatchObject({ role: 'user', content: 'Do you have openings today?' });
    expect(queued).toEqual([{ threadId: 'th1', text: 'Do you have openings today?' }]);
  });

  it('refused as Primary → asks for the thread instead, and still records the message', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(String(url));
      const take = String(url).includes('take_thread_control');
      return { ok: !take, status: take ? 400 : 200, json: async () => (take ? { error: { message: 'not the primary receiver' } } : { success: true }) };
    });
    const { svc, appended } = makeSvc();
    await (svc.handleWebhook as (b: unknown) => Promise<void>).call(svc, {
      object: 'page', entry: [{ id: 'p1', standby: [{ sender: { id: 'u1' }, recipient: { id: 'p1' }, message: { mid: 'm2', text: 'hi' } }] }],
    });
    expect(calls.some((u) => u.includes('/p1/request_thread_control'))).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it('a human typing in the Page Inbox (standby echo) makes the bot yield; another app’s echo is ignored', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    const { svc, paused, appended } = makeSvc();
    await (svc.handleWebhook as (b: unknown) => Promise<void>).call(svc, {
      object: 'page',
      entry: [{ id: 'p1', standby: [
        { sender: { id: 'p1' }, recipient: { id: 'u1' }, message: { mid: 'e1', is_echo: true, app_id: '263902037430900', text: 'Hi Maria, this is Kim' } },
        { sender: { id: 'p1' }, recipient: { id: 'u2' }, message: { mid: 'e2', is_echo: true, app_id: '999999', text: 'I am Meta AI' } },
      ] }],
    });
    expect(paused).toEqual([{ entryId: 'p1', customerId: 'u1', text: 'Hi Maria, this is Kim' }]);
    expect(appended).toHaveLength(0);
  });

  it('with the bot switched OFF the thread is not taken, the message is still recorded and the phones ring — nobody replies', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ success: true }) }; });
    const { svc, appended, queued, push } = makeSvc({ botEnabled: false });
    await (svc.handleWebhook as (b: unknown) => Promise<void>).call(svc, {
      object: 'page', entry: [{ id: 'p1', standby: [{ sender: { id: 'u1' }, recipient: { id: 'p1' }, message: { mid: 'm3', text: 'how much is a pedicure?' } }] }],
    });
    expect(calls.some((u) => u.includes('thread_control'))).toBe(false);
    expect(appended[0][0]).toMatchObject({ role: 'user', content: 'how much is a pedicure?' });
    expect(push.sendToTenant).toHaveBeenCalled();
    expect(queued).toHaveLength(0);
  });
});

describe('bot switch OFF on a normal message', () => {
  it('records the conversation and wakes the phones, but queues no reply', async () => {
    const { svc, appended, queued, push, events } = makeSvc({ botEnabled: false });
    await (svc.handleMessage as (...a: unknown[]) => Promise<void>).call(svc, 'p1', 'u1', 'hello?', NOW, 'messenger');
    expect(appended).toHaveLength(1);
    expect(events.publish).toHaveBeenCalled();
    expect(push.sendToTenant).toHaveBeenCalled();
    expect(queued).toHaveLength(0);
  });
});
