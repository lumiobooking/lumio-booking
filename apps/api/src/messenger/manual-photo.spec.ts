/**
 * A photo sent by a person from the Inbox (18/11/2026): stored in the
 * caller's own salon folder, sent only on the caller's own conversation,
 * inside Meta's window, and audited.
 */
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';

type Row = Record<string, unknown>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (tenantId: string, role = 'STAFF') => ({ userId: 'u1', tenantId, role }) as never;
const URL_OK = 'https://files.example.com/aaaa/p.jpg';

function build(o: { lastCustomerAt?: Date } = {}) {
  const threads: Row[] = [
    { id: 't-a', tenantId: A, pageId: 'pg-a', senderId: 'psid-a', channel: 'messenger', history: [{ role: 'user', content: 'mẫu nào đẹp em?', at: new Date().toISOString() }], lastCustomerAt: o.lastCustomerAt ?? new Date(), handoff: false },
    { id: 't-w', tenantId: A, pageId: 'web:a', senderId: 'v1', channel: 'web', history: [], lastCustomerAt: new Date() },
    { id: 't-b', tenantId: B, pageId: 'pg-b', senderId: 'psid-b', channel: 'messenger', history: [], lastCustomerAt: new Date() },
  ];
  const audits: Row[] = [];
  const own = (w: Row) => threads.filter((t) => (w.id === undefined || t.id === w.id) && t.tenantId === w.tenantId);
  const prisma = {
    messengerThread: {
      findFirst: async (q: { where: Row }) => own(q.where)[0] ?? null,
      updateMany: async (q: { where: Row; data: Row }) => { const hit = own(q.where); hit.forEach((t) => Object.assign(t, q.data)); return { count: hit.length }; },
    },
    messengerConnection: { findUnique: async (q: { where: { tenantId: string } }) => ({ tenantId: q.where.tenantId, pageId: 'pg', pageToken: `tok-${q.where.tenantId.slice(0, 1)}`, enabled: true }) },
    messengerPage: { findFirst: async () => null },
    user: { findUnique: async () => ({ firstName: 'Hoa', lastName: '', email: 'h@x.co' }) },
    auditLog: { create: async (q: { data: Row }) => { audits.push(q.data); return {}; } },
  };
  const events = { publish: jest.fn() };
  const s = new MessengerService(prisma as never, {} as never, {} as never, {} as never, events as never, {} as never);
  return { s, threads, audits, events };
}

describe('a photo from the reply box', () => {
  const realFetch = global.fetch;
  let calls: { url: string; body: Row }[] = [];
  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url: string, init: { body: string }) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ message_id: 'm1' }) }; }) as never;
  });
  afterEach(() => { global.fetch = realFetch; });

  it('goes to the customer as an image, is written on the conversation, takes it from the AI, and is audited', async () => {
    const { s, threads, audits } = build();
    const r = await s.sendManualPhoto(user(A), 't-a', URL_OK);
    expect(r).toMatchObject({ ok: true, channel: 'messenger', url: URL_OK });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('tok-a');
    expect(calls[0].body).toMatchObject({ recipient: { id: 'psid-a' }, message: { attachment: { type: 'image', payload: { url: URL_OK } } } });
    const last = (threads[0].history as Row[]).slice(-1)[0];
    expect(last).toMatchObject({ role: 'assistant', manual: true, images: [URL_OK], messageId: 'm1', by: 'Hoa' });
    expect(threads[0].handoff).toBe(true);
    expect(audits.map((a) => `${a.tenantId}:${a.action}`)).toEqual([`${A}:messenger.manual_photo`]);
  });

  it('CROSS-TENANT: another salon\'s conversation is "not found" — nothing is sent, written or audited', async () => {
    const { s, threads, audits } = build();
    await expect(s.sendManualPhoto(user(A), 't-b', URL_OK)).rejects.toThrow('Thread not found');
    await expect(s.assertOwnThread(user(A), 't-b')).rejects.toThrow('Thread not found');
    await expect(s.assertOwnThread(user(B), 't-b')).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    expect(threads[2].history).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('only a public https address is ever sent', async () => {
    const { s } = build();
    for (const bad of ['http://x.co/a.jpg', 'javascript:alert(1)', 'https://x.co/a b.jpg', '', 'file:///etc/passwd']) {
      await expect(s.sendManualPhoto(user(A), 't-a', bad)).rejects.toThrow('Not a photo address.');
    }
    expect(calls).toEqual([]);
  });

  it('past Meta\'s seven days nothing is sent — decided by the server', async () => {
    const { s } = build({ lastCustomerAt: new Date(Date.now() - 9 * 86_400_000) });
    const hist = [{ role: 'user', content: 'hi', at: new Date(Date.now() - 9 * 86_400_000).toISOString() }];
    (s as unknown as { prisma: { messengerThread: { findFirst: () => Promise<Row> } } }).prisma.messengerThread.findFirst = async () => ({ id: 't-a', tenantId: A, pageId: 'pg-a', senderId: 'psid-a', channel: 'messenger', history: hist, lastCustomerAt: new Date(Date.now() - 9 * 86_400_000) });
    await expect(s.sendManualPhoto(user(A), 't-a', URL_OK)).rejects.toMatchObject({ status: 403 });
    expect(calls).toEqual([]);
  });

  it('a website conversation needs no Page: the photo is written where the visitor\'s browser reads', async () => {
    const { s, threads } = build();
    const r = await s.sendManualPhoto(user(A), 't-w', URL_OK);
    expect(r.channel).toBe('web');
    expect(calls).toEqual([]);
    expect((threads[1].history as Row[])[0]).toMatchObject({ images: [URL_OK], manual: true });
  });

  it('Meta refusing it is recorded as failed and told to the sender', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: '(#10) outside window' } }) })) as never;
    const { s, threads, audits } = build();
    await expect(s.sendManualPhoto(user(A), 't-a', URL_OK)).rejects.toThrow('outside window');
    expect((threads[0].history as Row[]).slice(-1)[0]).toMatchObject({ failed: true, images: [URL_OK] });
    expect(audits).toEqual([]);
  });
});

describe('the endpoint', () => {
  const roles = (m: string) => Reflect.getMetadata('roles', (MessengerController.prototype as unknown as Record<string, object>)[m]) as string[];
  it('is for the people who work the inbox', () => {
    expect(roles('sendPhoto').sort()).toEqual(['SALON_ADMIN', 'STAFF']);
  });

  it('stores the picture in the CALLER\'S salon folder, only after the conversation is found to be theirs, and takes pictures only', async () => {
    const stored: string[] = [];
    const svc = { assertOwnThread: jest.fn(async (_u: unknown, id: string) => { if (id !== 't-a') throw new Error('Thread not found'); }), sendManualPhoto: jest.fn(async () => ({ ok: true })) };
    const uploads = { uploadDataUrl: jest.fn(async (tenantId: string) => { stored.push(tenantId); return URL_OK; }) };
    const c = new MessengerController(svc as never, {} as never, {} as never, {} as never, {} as never, uploads as never);
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await c.sendPhoto(user(A), 't-a', { dataUrl: png });
    expect(stored).toEqual([A]);
    expect(svc.sendManualPhoto).toHaveBeenCalledWith(expect.anything(), 't-a', URL_OK);
    await expect(c.sendPhoto(user(A), 't-b', { dataUrl: png })).rejects.toThrow('Thread not found');
    await expect(c.sendPhoto(user(A), 't-a', { dataUrl: 'data:text/html;base64,PGI+' })).rejects.toThrow('JPG');
    await expect(c.sendPhoto(user(A), 't-a', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).rejects.toThrow('JPG');
    expect(stored).toEqual([A]); // nothing more was stored
  });
});
