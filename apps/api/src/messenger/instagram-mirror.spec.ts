/**
 * Instagram DMs are mirrored from the Page's /conversations edge like
 * Messenger ones, so a DM the webhook dropped still reaches the inbox; and a
 * refusal from Meta is reported, not repeated into the log every minute.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc() {
  const threads: Row[] = [];
  const prisma = {
    messengerPage: { findMany: async ({ where }: Row) => (where.tenantId === 't1' ? [{ pageId: 'p1', pageToken: 'TOK', pageName: 'An Sen', igId: 'ig1' }] : []) },
    messengerConnection: { findUnique: async () => null },
    messengerThread: {
      findUnique: async ({ where }: Row) => threads.find((t) => t.pageId === where.pageId_senderId?.pageId && t.senderId === where.pageId_senderId?.senderId) ?? null,
      create: async ({ data }: Row) => { const r = { id: `th${threads.length + 1}`, ...data }; threads.push(r); return r; },
      update: async ({ where, data }: Row) => { const t = threads.find((x) => x.id === where.id)!; Object.assign(t, data); return t; },
    },
  };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, { publish: jest.fn() } as never, {} as never);
  const handled: Row[] = [];
  (svc as unknown as Row).handleMessage = async (entry: string, senderId: string, text: string, _ts: number, channel: string) => { handled.push({ entry, senderId, text, channel }); };
  return { svc, threads, handled };
}

describe('the Instagram mirror', () => {
  const realFetch = global.fetch;
  const prevIg = process.env.FB_ENABLE_INSTAGRAM;
  beforeEach(() => { process.env.FB_ENABLE_INSTAGRAM = '1'; });
  afterEach(() => { (global as any).fetch = realFetch; process.env.FB_ENABLE_INSTAGRAM = prevIg; }); // eslint-disable-line @typescript-eslint/no-explicit-any

  it('reads platform=instagram too; the customer is the participant who is neither the account nor the Page', async () => {
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      urls.push(String(url));
      if (String(url).includes('platform=instagram')) {
        return { ok: true, json: async () => ({ data: [{ id: 'c9', updated_time: '2026-10-27T03:00:00+0000',
          participants: { data: [{ id: 'ig1', username: 'ansenwellness' }, { id: 'igs77', username: 'jane.doe' }] },
          messages: { data: [
            { message: 'Yes we have 3pm', from: { id: 'ig1' }, created_time: '2026-10-26T03:01:00+0000' },
            { message: 'Any opening Saturday?', from: { id: 'igs77' }, created_time: '2026-10-26T03:00:00+0000' },
          ] } }] }) };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });
    const { svc, threads } = makeSvc();
    const r = await svc.syncConversations('t1', { limit: 20, reply: false });
    expect(urls.some((u) => u.includes('/p1/conversations?platform=instagram'))).toBe(true);
    expect(r.imported).toBe(1);
    expect(threads[0]).toMatchObject({ tenantId: 't1', pageId: 'p1', senderId: 'igs77', senderName: 'jane.doe', channel: 'instagram' });
    expect(threads[0].history.map((t: Row) => [t.role, t.content])).toEqual([['user', 'Any opening Saturday?'], ['assistant', 'Yes we have 3pm']]);
  });

  it('a DM the webhook missed goes to the live path on the Instagram channel', async () => {
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    (global as any).fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('platform=instagram') // eslint-disable-line @typescript-eslint/no-explicit-any
      ? { data: [{ id: 'c9', participants: { data: [{ id: 'ig1' }, { id: 'igs77', username: 'jane' }] }, messages: { data: [{ message: 'hello?', from: { id: 'igs77' }, created_time: old }] } }] }
      : { data: [] }) }));
    const { svc, handled } = makeSvc();
    await svc.syncConversations('t1', { limit: 20 });
    expect(handled).toEqual([{ entry: 'ig1', senderId: 'igs77', text: 'hello?', channel: 'instagram' }]);
  });

  it('Meta refusing Instagram is reported on a manual mirror, kept quiet in the minute sweep', async () => {
    (global as any).fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('platform=instagram') // eslint-disable-line @typescript-eslint/no-explicit-any
      ? { error: { message: '(#3) Application does not have the capability to make this API call.', code: 3 } }
      : { data: [] }) }));
    const { svc } = makeSvc();
    const manual = await svc.syncConversations('t1', { limit: 20 });
    expect(manual.errors).toEqual(['An Sen (Instagram): (#3) Application does not have the capability to make this API call. (code 3)']);
    const sweep = await svc.syncConversations('t1', { limit: 10, incremental: true });
    expect(sweep.errors).toEqual([]);
  });

  it('with Instagram switched off on the server, only Messenger is read', async () => {
    process.env.FB_ENABLE_INSTAGRAM = '0';
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => { urls.push(String(url)); return { ok: true, json: async () => ({ data: [] }) }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const { svc } = makeSvc();
    await svc.syncConversations('t1', { limit: 20 });
    expect(urls.every((u) => u.includes('platform=messenger'))).toBe(true);
  });
});
