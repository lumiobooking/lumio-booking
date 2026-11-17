/**
 * SUPPORT'S TEST OF THE TYPING DOTS (MessengerService.typingTestStart).
 *
 * On 17/11/2026 Meta accepted "seen", "typing on" and "typing off" for the
 * owner's test and his phone showed "Seen" but no dots. Whether a phone draws
 * the dots cannot be read from a server, so support can show them for a few
 * seconds on a conversation and watch. That tool reaches a customer's phone,
 * so what it may touch is pinned here:
 *
 *  - only a conversation of a TEST ACCOUNT, never a paying salon's customer —
 *    not even when its thread id is named outright;
 *  - only Super Admin may press it;
 *  - it sends sender actions and nothing else: no message, ever;
 *  - a Page token is never borrowed from another salon.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { MessengerService } from './messenger.service';
import { SupportAiFleetController } from './support-ai-leaks.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SEEN_TO_TYPING_MS, resetPresenceStats } from './presence';

type Row = Record<string, unknown>;
const TEST = 'test-salon';
const PAYING = 'amys-lash';

function build(o: { threads: Row[]; pages?: Row[]; conns?: Row[] }) {
  const asked: Row[] = [];
  const prisma = {
    messengerThread: {
      findUnique: async (q: { where: { id: string } }) => o.threads.find((t) => t.id === q.where.id) ?? null,
      findFirst: async (q: { where: { tenantId: { in: string[] }; lastCustomerAt: { gte: Date } } }) => {
        asked.push(q.where as Row);
        return o.threads
          .filter((t) => q.where.tenantId.in.includes(String(t.tenantId)) && t.lastCustomerAt instanceof Date && t.lastCustomerAt >= q.where.lastCustomerAt.gte
            && !String(t.pageId).startsWith('web:') && !String(t.pageId).startsWith('zalo:'))
          .sort((a, b) => (b.lastCustomerAt as Date).getTime() - (a.lastCustomerAt as Date).getTime())[0] ?? null;
      },
    },
    messengerPage: { findUnique: async (q: { where: { pageId: string } }) => (o.pages ?? []).find((p) => p.pageId === q.where.pageId) ?? null },
    messengerConnection: { findUnique: async (q: { where: { tenantId: string } }) => (o.conns ?? []).find((c) => c.tenantId === q.where.tenantId) ?? null },
    tenant: { findUnique: async (q: { where: { id: string } }) => ({ name: q.where.id === TEST ? 'Lumio Agency' : 'A paying salon' }) },
  };
  const release = { isOn: () => false, isTestAccount: (id: string) => id === TEST, testAccountIds: () => [TEST] };
  const s = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined, release as never);
  return { s, asked };
}
const bodies = (f: jest.Mock) => f.mock.calls.map((c) => JSON.parse(String((c[1] as { body: string }).body)) as Row);
const mins = (n: number) => new Date(Date.now() - n * 60_000);

describe("support's test of the typing dots", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    resetPresenceStats();
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
    global.fetch = fetchMock as never;
  });
  afterEach(() => { jest.useRealTimers(); global.fetch = realFetch; });

  it('takes the conversation a customer just wrote in ON A TEST ACCOUNT, shows the dots, and sends no message', async () => {
    const { s, asked } = build({
      threads: [
        { id: 'paying-1', tenantId: PAYING, pageId: 'P9', senderId: 'PSID-PAYING', channel: 'messenger', lastCustomerAt: mins(0) }, // newer, but a paying salon
        { id: 'mine', tenantId: TEST, pageId: 'P1', senderId: 'PSID-ME', channel: 'messenger', lastCustomerAt: mins(2) },
        { id: 'older', tenantId: TEST, pageId: 'P1', senderId: 'PSID-OLD', channel: 'messenger', lastCustomerAt: mins(20) },
      ],
      pages: [{ pageId: 'P1', tenantId: TEST, pageToken: 'TOKEN-TEST' }, { pageId: 'P9', tenantId: PAYING, pageToken: 'TOKEN-PAYING' }],
    });
    const out = await s.typingTestStart({ seconds: 12 });
    expect(out).toMatchObject({ started: true, account: 'Lumio Agency', channel: 'messenger', seconds: 12, tenantId: TEST });
    expect((asked[0] as { tenantId: { in: string[] } }).tenantId.in).toEqual([TEST]); // the search itself is scoped to the test accounts
    await jest.advanceTimersByTimeAsync(13_000);
    const sent = bodies(fetchMock);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const b of sent) {
      expect(b.recipient).toEqual({ id: 'PSID-ME' });               // only that one person
      expect(Object.keys(b).sort()).toEqual(['recipient', 'sender_action']); // a sender action and nothing else: no message
    }
    expect(sent.map((b) => b.sender_action)).toEqual(['typing_on', 'typing_on', 'typing_off']); // on at 0 s, renewed at 6 s, off at 12 s
    for (const c of fetchMock.mock.calls) expect(String(c[0])).toContain('access_token=TOKEN-TEST');
    const last = s.typingTestLast();
    expect(last).toMatchObject({ running: false, account: 'Lumio Agency', seenFirst: false });
    expect(last?.calls.every((c) => c.ok)).toBe(true);
    expect(JSON.stringify(last)).not.toContain('TOKEN');
    expect(JSON.stringify(last)).not.toContain('PSID');
  });

  it('"seen" first, then the dots a moment later — the order the AI itself now uses', async () => {
    const { s } = build({
      threads: [{ id: 'mine', tenantId: TEST, pageId: 'P1', senderId: 'PSID-ME', channel: 'instagram', lastCustomerAt: mins(1) }],
      pages: [{ pageId: 'P1', tenantId: TEST, pageToken: 'TOKEN-TEST' }],
    });
    expect((await s.typingTestStart({ seenFirst: true, seconds: 3 })).started).toBe(true);
    await jest.advanceTimersByTimeAsync(SEEN_TO_TYPING_MS - 100);
    expect(bodies(fetchMock).map((b) => b.sender_action)).toEqual(['mark_seen']);
    await jest.advanceTimersByTimeAsync(4_500);
    expect(bodies(fetchMock).map((b) => b.sender_action)).toEqual(['mark_seen', 'typing_on', 'typing_off']);
  });

  it('a paying salon is refused even when its conversation is named outright — nothing reaches its customer', async () => {
    const { s } = build({
      threads: [{ id: 'paying-1', tenantId: PAYING, pageId: 'P9', senderId: 'PSID-PAYING', channel: 'messenger', lastCustomerAt: mins(0) }],
      pages: [{ pageId: 'P9', tenantId: PAYING, pageToken: 'TOKEN-PAYING' }],
    });
    const out = await s.typingTestStart({ threadId: 'paying-1' });
    expect(out).toEqual({ started: false, reason: 'not-a-test-account' });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.typingTestLast()).toBeNull();
  });

  it('nobody wrote in the last half hour: nothing is sent to an old conversation', async () => {
    const { s } = build({
      threads: [{ id: 'old', tenantId: TEST, pageId: 'P1', senderId: 'PSID-OLD', channel: 'messenger', lastCustomerAt: mins(45) }],
      pages: [{ pageId: 'P1', tenantId: TEST, pageToken: 'TOKEN-TEST' }],
    });
    expect(await s.typingTestStart()).toEqual({ started: false, reason: 'no-recent-thread' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the website chat and Zalo have no such dots, and a Page token is never borrowed from another salon', async () => {
    const web = build({ threads: [{ id: 'w', tenantId: TEST, pageId: 'web:test-salon', senderId: 'v1', channel: 'web', lastCustomerAt: mins(1) }] });
    expect((await web.s.typingTestStart({ threadId: 'w' })).reason).toBe('channel-has-no-typing');
    // The thread's Page row belongs to ANOTHER salon (a Page that moved): its token is not used.
    const moved = build({
      threads: [{ id: 'm', tenantId: TEST, pageId: 'P9', senderId: 'PSID-ME', channel: 'messenger', lastCustomerAt: mins(1) }],
      pages: [{ pageId: 'P9', tenantId: PAYING, pageToken: 'TOKEN-PAYING' }],
      conns: [{ tenantId: TEST, pageId: 'P1', pageToken: 'TOKEN-TEST' }], // the test account's own Page is a different one
    });
    expect((await moved.s.typingTestStart({ threadId: 'm' })).reason).toBe('no-token');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('one test at a time', async () => {
    const { s } = build({
      threads: [{ id: 'mine', tenantId: TEST, pageId: 'P1', senderId: 'PSID-ME', channel: 'messenger', lastCustomerAt: mins(1) }],
      pages: [{ pageId: 'P1', tenantId: TEST, pageToken: 'TOKEN-TEST' }],
    });
    expect((await s.typingTestStart({ seconds: 10 })).started).toBe(true);
    expect(await s.typingTestStart({ seconds: 10 })).toEqual({ started: false, reason: 'busy' });
    await jest.advanceTimersByTimeAsync(11_000);
    expect(s.typingTestLast()?.running).toBe(false);
    expect((await s.typingTestStart({ seconds: 3 })).started).toBe(true);
    await jest.advanceTimersByTimeAsync(4_000);
  });

  it('Meta refusing is reported as it is, without the token', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"(#10) outside the allowed window https://graph.facebook.com/x?access_token=TOKEN-TEST"}}' }));
    const { s } = build({
      threads: [{ id: 'mine', tenantId: TEST, pageId: 'P1', senderId: 'PSID-ME', channel: 'messenger', lastCustomerAt: mins(1) }],
      pages: [{ pageId: 'P1', tenantId: TEST, pageToken: 'TOKEN-TEST' }],
    });
    await s.typingTestStart({ seconds: 3 });
    await jest.advanceTimersByTimeAsync(4_000);
    const last = s.typingTestLast();
    expect(last?.calls[0]).toMatchObject({ action: 'typing_on', ok: false, status: 400 });
    expect(last?.calls[0].error).toContain('outside the allowed window');
    expect(JSON.stringify(last)).not.toContain('TOKEN-TEST');
  });

  it('only Super Admin may press it or read its result; the audit names the test account, and the answer carries no internal id', async () => {
    const proto = SupportAiFleetController.prototype as never as Record<string, object>;
    expect(Reflect.getMetadata(ROLES_KEY, proto.typingTest)).toEqual([UserRole.SUPER_ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, proto.typingTestLast)).toEqual([UserRole.SUPER_ADMIN]);
    const audits: Row[] = [];
    const messenger = { typingTestStart: jest.fn(async () => ({ started: true, tenantId: TEST, account: 'Lumio Agency', channel: 'messenger', seconds: 12, lastCustomerAt: null })), typingTestLast: () => null };
    const prisma = { auditLog: { create: async (q: { data: Row }) => { audits.push(q.data); return q.data; } } };
    const c = new SupportAiFleetController({} as never, prisma as never, messenger as never);
    const out = await c.typingTest({ userId: 'u-super' } as never, { seenFirst: true });
    expect(out).toEqual({ started: true, account: 'Lumio Agency', channel: 'messenger', seconds: 12, lastCustomerAt: null });
    expect(JSON.stringify(out)).not.toContain(TEST);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ tenantId: TEST, userId: 'u-super', action: 'support.typing_test' });
  });
});
