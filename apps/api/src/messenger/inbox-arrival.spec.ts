/**
 * "Khách đã nhắn mà màn hình Inbox chưa hiện."
 *
 * The customer's turn used to be written to the conversation only after the
 * bot's reply was ready (a 4-second gather window plus the whole AI run), so
 * the inbox could not show it, sort it to the top or mark it unread until
 * then. Now it is written on arrival with an id (rid), and the reply step
 * recognises exactly those turns instead of adding them a second time.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function makeSvc(thread: Row) {
  const appended: Row[][] = [];
  const queued: Row[] = [];
  const agentCalls: { history: Row[]; text: string }[] = [];
  const events = { publish: jest.fn() };
  const prisma = {
    messengerConnection: { findUnique: async () => ({ tenantId: 't1', enabled: true, pageToken: 'TOK', aiInstruction: null, botFacts: [] }) },
    messengerThread: {
      upsert: async () => thread,
      update: async () => thread,
      findUnique: async () => thread,
    },
    salesLead: { findFirst: async () => null },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago', market: 'US' }) },
  };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, events as never, { sendToTenant: async () => undefined } as never);
  const s = svc as unknown as Record<string, unknown>;
  s.pageByEntry = async () => ({ tenantId: 't1', pageId: 'p1', pageToken: 'TOK', enabled: true });
  s.fetchSenderName = async () => null;
  s.appendTurns = async (_id: string, _h: Row[], _m: unknown, turns: Row[]) => {
    appended.push(turns);
    thread.history = [...(thread.history ?? []), ...turns];
  };
  s.queueReply = (_c: unknown, threadId: string, _s: string, text: string, _ts: unknown, _a: unknown, rid?: string) => { queued.push({ threadId, text, rid }); };
  s.knownCustomerFor = async () => null;
  s.runAgent = async (_t: string, _i: string, history: Row[], text: string) => { agentCalls.push({ history, text }); return 'Our grand opening is the 9th 🎉 Any other questions?'; };
  s.sendText = async () => ({ ok: true });
  s.countBotReply = () => undefined;
  return { svc: s, appended, queued, agentCalls, events, thread };
}

describe('the customer’s message reaches the inbox on arrival', () => {
  it('is written to the conversation BEFORE the bot replies, with an id, and the inbox is told', async () => {
    const thread: Row = { id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', senderName: 'Delois', handoff: false, history: [], status: 'open' };
    const { svc, appended, queued, events } = makeSvc(thread);
    await (svc.handleMessage as (...a: unknown[]) => Promise<void>).call(svc, 'p1', 'u1', 'when is your grand opening', NOW, 'messenger');
    expect(appended).toHaveLength(1);
    expect(appended[0][0]).toMatchObject({ role: 'user', content: 'when is your grand opening' });
    const rid = appended[0][0].rid;
    expect(typeof rid).toBe('string');
    // The reply is queued with the same id, so the reply step can find the turn.
    expect(queued).toEqual([{ threadId: 'th1', text: 'when is your grand opening', rid }]);
    // Told twice: once for the list (lastText), once with the turn in place.
    expect(events.publish).toHaveBeenCalledTimes(2);
  });

  it('the website chat keeps the old order (the visitor already sees their own message)', async () => {
    const thread: Row = { id: 'th2', tenantId: 't1', pageId: 'web:t1', senderId: 'v1', senderName: null, handoff: false, history: [] };
    const { svc, appended, queued } = makeSvc(thread);
    await (svc.handleMessage as (...a: unknown[]) => Promise<void>).call(svc, 'web:t1', 'v1', 'hi', NOW, 'web');
    expect(appended).toHaveLength(0);
    expect(queued[0].rid).toBeUndefined();
  });
});

describe('the reply step recognises turns written on arrival', () => {
  it('does not add them again, and hands the model the conversation BEFORE them', async () => {
    const thread: Row = {
      id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', channel: 'messenger', handoff: false,
      lastCustomerAt: new Date(NOW - 5_000),
      history: [
        { role: 'assistant', content: 'Hi! What can I book for you?', at: iso(60_000) },
        { role: 'user', content: 'Delois Jones 3343904874', at: iso(6_000), rid: 'r1' },
        { role: 'user', content: 'when is your grand opening', at: iso(5_000), rid: 'r2' },
      ],
    };
    const { svc, appended, agentCalls } = makeSvc(thread);
    await (svc.replyAndRecord as (...a: unknown[]) => Promise<void>).call(
      svc, { tenantId: 't1', pageToken: 'TOK', aiInstruction: null, botFacts: [] }, 'th1', 'u1',
      'Delois Jones 3343904874\nwhen is your grand opening', NOW - 5_000, {}, ['r1', 'r2'],
    );
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].history.map((h) => h.content)).toEqual(['Hi! What can I book for you?']);
    expect(agentCalls[0].text).toBe('Delois Jones 3343904874\nwhen is your grand opening');
    // Only the bot's answer is appended — the customer's turns are already there.
    expect(appended).toHaveLength(1);
    expect(appended[0].map((t) => t.role)).toEqual(['assistant']);
  });

  it('a message that arrived while the bot was still thinking stays for the NEXT reply', async () => {
    const thread: Row = {
      id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', channel: 'messenger', handoff: false,
      lastCustomerAt: new Date(NOW - 2_000),
      history: [
        { role: 'user', content: 'hi', at: iso(9_000), rid: 'r1' },
        { role: 'user', content: 'also do you do lashes?', at: iso(2_000), rid: 'r9' },
      ],
    };
    const { svc, agentCalls, appended } = makeSvc(thread);
    await (svc.replyAndRecord as (...a: unknown[]) => Promise<void>).call(
      svc, { tenantId: 't1', pageToken: 'TOK', aiInstruction: null, botFacts: [] }, 'th1', 'u1', 'hi', NOW - 9_000, {}, ['r1'],
    );
    // r9 is not this burst's: it stays in the history the model reads, and is not re-added.
    expect(agentCalls[0].history.map((h) => h.content)).toEqual(['also do you do lashes?']);
    expect(appended[0].map((t) => t.role)).toEqual(['assistant']);
  });

  it('without ids (an older path) it behaves exactly as before', async () => {
    const thread: Row = {
      id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', channel: 'messenger', handoff: false,
      lastCustomerAt: new Date(NOW - 2_000),
      history: [{ role: 'assistant', content: 'Hello!', at: iso(60_000) }],
    };
    const { svc, appended } = makeSvc(thread);
    await (svc.replyAndRecord as (...a: unknown[]) => Promise<void>).call(
      svc, { tenantId: 't1', pageToken: 'TOK', aiInstruction: null, botFacts: [] }, 'th1', 'u1', 'hi', NOW - 2_000, {},
    );
    expect(appended[0].map((t) => t.role)).toEqual(['user', 'assistant']);
  });
});
