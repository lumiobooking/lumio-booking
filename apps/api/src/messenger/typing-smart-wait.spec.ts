/**
 * The customer sees "seen" at once and the typing dots a moment later, and the wait before
 * the AI answers is sized by what they sent — both only where the behaviour
 * has been released (common/ai-release): a salon that is not a test account
 * keeps the fixed six seconds and no dots until promotion.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService } from './messenger.service';
import { resetPresenceStats, presenceStats, SEEN_TO_TYPING_MS } from './presence';

type Row = Record<string, unknown>;
type Svc = {
  queueReply: (conn: Row, threadId: string, senderId: string, text: string, eventTs?: number, attach?: Row, rid?: string, meta?: Row) => void;
  replyAndRecord: jest.Mock;
};

function build(given: { typing?: boolean; seen?: boolean; smartWait?: boolean } | null) {
  const prisma = { messengerThread: { findUnique: async () => ({ channel: 'messenger', pageId: 'P1' }) } };
  // "Seen" follows the dots unless a test moves its own switch.
  const on = given ? { seen: given.typing, ...given } : null;
  const release = on ? { isOn: (f: 'typing' | 'seen' | 'smartWait', tenantId: string) => tenantId === 'test-salon' && Boolean(on[f]) } : undefined;
  const s = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined, release as never) as unknown as Svc;
  s.replyAndRecord = jest.fn(async () => undefined);
  return s;
}
const conn = (tenantId: string) => ({ tenantId, pageToken: 'TOKEN', aiInstruction: null, botFacts: null });
const actions = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((c) => (JSON.parse(String((c[1] as { body: string }).body)) as { sender_action?: string }).sender_action);

describe('"seen", the typing dots and the adaptive wait', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    resetPresenceStats();
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
    global.fetch = fetchMock as never;
  });
  afterEach(() => { jest.useRealTimers(); global.fetch = realFetch; });

  it('test account: "seen" at once, the dots a moment later (never the same instant), ended when the reply is out', async () => {
    const s = build({ typing: true, smartWait: true });
    // The AI takes two seconds over this one.
    s.replyAndRecord = jest.fn(() => new Promise<void>((r) => { setTimeout(r, 2000); }));
    s.queueReply(conn('test-salon'), 'th1', 'PSID1', 'Xem tất cả gói', Date.now(), {}, undefined, { tap: true, channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(50);
    expect(actions(fetchMock)).toEqual(['mark_seen']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/me/messages');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body))).toEqual({ recipient: { id: 'PSID1' }, sender_action: 'mark_seen' });
    await jest.advanceTimersByTimeAsync(SEEN_TO_TYPING_MS - 100);
    expect(actions(fetchMock)).toEqual(['mark_seen']); // 17/11: back to back, the dots never showed
    await jest.advanceTimersByTimeAsync(150);
    expect(actions(fetchMock)).toEqual(['mark_seen', 'typing_on']);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1); // a tap is not kept waiting for the dots
    await jest.advanceTimersByTimeAsync(2000);
    expect(actions(fetchMock)).toEqual(['mark_seen', 'typing_on', 'typing_off']);
    expect(presenceStats().sent).toBe(3);
    expect(presenceStats().byAction.typing_on.ok).toBe(1);
  });

  it('a reply that is out before the dots were due: "seen" only — no dots after the answer, and no "off" for dots never shown', async () => {
    const s = build({ typing: true, smartWait: true });
    s.queueReply(conn('test-salon'), 'th1b', 'PSID1', 'Xem tất cả gói', Date.now(), {}, undefined, { tap: true, channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(450);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(actions(fetchMock)).toEqual(['mark_seen']);
  });

  it('the "seen" switch taken away: the dots at once and no read receipt — to see whether the one hides the other', async () => {
    const s = build({ typing: true, seen: false, smartWait: true });
    s.replyAndRecord = jest.fn(() => new Promise<void>((r) => { setTimeout(r, 2000); }));
    s.queueReply(conn('test-salon'), 'th1c', 'PSID1', 'giá gói marketing', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(50);
    expect(actions(fetchMock)).toEqual(['typing_on']);
    await jest.advanceTimersByTimeAsync(4000);
    expect(actions(fetchMock)).toEqual(['typing_on', 'typing_off']);
  });

  it('the dots switch taken away: the read receipt alone, nothing renewed and nothing to turn off', async () => {
    const s = build({ typing: false, seen: true, smartWait: true });
    let done: () => void = () => undefined;
    s.replyAndRecord = jest.fn(() => new Promise<void>((r) => { done = r; }));
    s.queueReply(conn('test-salon'), 'th1d', 'PSID1', 'giá gói marketing', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(20_000);
    expect(actions(fetchMock)).toEqual(['mark_seen']);
    done();
    await jest.advanceTimersByTimeAsync(100);
    expect(actions(fetchMock)).toEqual(['mark_seen']);
  });

  it('test account: a whole question waits about a second, not six', async () => {
    const s = build({ typing: false, smartWait: true });
    s.queueReply(conn('test-salon'), 'th2', 'PSID2', 'giá gói marketing', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(900);
    expect(s.replyAndRecord).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(250);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled(); // typing was not released
  });

  it('a customer still writing is given a moment more, and both messages are answered together', async () => {
    const s = build({ typing: false, smartWait: true });
    s.queueReply(conn('test-salon'), 'th3', 'PSID3', 'cho hỏi giá', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(800);
    s.queueReply(conn('test-salon'), 'th3', 'PSID3', 'uốn mi bao nhiêu', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(250);   // the first wait ends 0.25 s after the second message: settle
    expect(s.replyAndRecord).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(String(s.replyAndRecord.mock.calls[0][3])).toContain('uốn mi bao nhiêu');
    expect(String(s.replyAndRecord.mock.calls[0][3])).toContain('cho hỏi giá');
  });

  it('a salon that is NOT a test account: no dots, and the fixed six seconds exactly as before', async () => {
    const s = build({ typing: true, smartWait: true });
    s.queueReply(conn('amys-lash'), 'th4', 'PSID4', 'where are you located?', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P9' });
    await jest.advanceTimersByTimeAsync(5900);
    expect(s.replyAndRecord).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without the release service (older wiring) nothing changes at all', async () => {
    const s = build(null);
    s.queueReply(conn('test-salon'), 'th5', 'PSID5', 'hi', Date.now(), {}, undefined, { tap: true, channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(5900);
    expect(s.replyAndRecord).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no dots on the website chat or Zalo, and none for somebody who asked us to stop', async () => {
    const s = build({ typing: true, smartWait: true });
    s.queueReply(conn('test-salon'), 'w1', 'visitor-1', 'hello there, are you open?', Date.now(), {}, undefined, { channel: 'web', pageId: 'web:test-salon' });
    s.queueReply(conn('test-salon'), 'z1', 'zalo-user', 'cho hỏi giá gel', Date.now(), {}, undefined, { channel: 'zalo', pageId: 'zalo:123' });
    s.queueReply(conn('test-salon'), 'm1', 'PSID6', 'STOP', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(4000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.replyAndRecord).toHaveBeenCalledTimes(3);
  });

  it('Meta refusing the dots never touches the reply', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"(#10) outside window"}}' }));
    const s = build({ typing: true, smartWait: true });
    s.queueReply(conn('test-salon'), 'th7', 'PSID7', 'giá gói marketing', Date.now(), {}, undefined, { channel: 'instagram', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(1300);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(presenceStats().failed).toBeGreaterThan(0);
    expect(presenceStats().lastError).toContain('outside window');
  });

  it('a long reply keeps the dots alive, and they never outlive a minute', async () => {
    const s = build({ typing: true, smartWait: true });
    let done: () => void = () => undefined;
    s.replyAndRecord = jest.fn(() => new Promise<void>((r) => { done = r; }));
    s.queueReply(conn('test-salon'), 'th8', 'PSID8', 'giá gói marketing', Date.now(), {}, undefined, { channel: 'messenger', pageId: 'P1' });
    await jest.advanceTimersByTimeAsync(17_500);
    expect(actions(fetchMock).filter((a) => a === 'typing_on').length).toBe(3); // 0.8 s after "seen", then at 6 s and 12 s
    await jest.advanceTimersByTimeAsync(60_000);
    expect(actions(fetchMock).at(-1)).toBe('typing_off');
    const n = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(n); // nothing more is sent
    done();
  });
});
