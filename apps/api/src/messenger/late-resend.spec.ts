/**
 * A reply Meta refused seconds after the customer wrote is sent again later —
 * the same text, while it is still the last word and the customer's 24 hours last.
 */
import { nextRetry, resendVerdict } from './late-resend';
import { FRESH_RETRY_AFTER_MIN } from './send-errors';
import { MessengerService } from './messenger.service';

const T0 = Date.parse('2026-10-30T06:35:55Z');
const refused = (n = 0, next = T0 + 2 * 60_000) => ({ role: 'assistant', failed: true, retry: { first: new Date(T0).toISOString(), n, next: new Date(next).toISOString(), customerAt: '2026-10-30T06:34:45Z' } });
const open = { status: 'open', handoff: false, handoffMode: null, lastCustomerAt: '2026-10-30T06:34:45Z' };

describe('when the kept reply is sent again', () => {
  it('due → send; not yet due → wait', () => {
    expect(resendVerdict(refused(), open, true, T0 + 2 * 60_000)).toEqual({ send: true });
    expect(resendVerdict(refused(), open, true, T0 + 60_000)).toEqual({ send: false, why: 'not-due' });
  });
  it('stops when a person answered or the customer got a fresh reply (it is not the last line any more)', () => {
    expect(resendVerdict({ role: 'user' }, open, true, T0 + 5 * 60_000)).toEqual({ send: false, why: 'not-last' });
    expect(resendVerdict({ role: 'assistant' }, open, true, T0 + 5 * 60_000)).toEqual({ send: false, why: 'not-refused' });
  });
  it('stops when the chat is locked to a person, done, or the bot is off', () => {
    expect(resendVerdict(refused(), { ...open, handoff: true, handoffMode: 'locked' }, true, T0 + 3 * 60_000)).toEqual({ send: false, why: 'locked' });
    expect(resendVerdict(refused(), { ...open, status: 'done' }, true, T0 + 3 * 60_000)).toEqual({ send: false, why: 'closed' });
    expect(resendVerdict(refused(), open, false, T0 + 3 * 60_000)).toEqual({ send: false, why: 'bot-off' });
  });
  it("never outside the customer's 24 hours, never past the schedule", () => {
    expect(resendVerdict(refused(), open, true, T0 + 24 * 3600 * 1000)).toEqual({ send: false, why: 'too-old' });
    expect(resendVerdict(refused(FRESH_RETRY_AFTER_MIN.length), open, true, T0 + 90 * 60_000)).toEqual({ send: false, why: 'spent' });
  });
  it('the schedule: 2, 4, 8, 15, 30, 60 minutes after the first refusal, then done', () => {
    let r = { first: new Date(T0).toISOString(), n: 0 };
    const at: number[] = [];
    for (;;) {
      const nx = nextRetry(r, T0);
      if (!nx.next) break;
      at.push(Math.round((Date.parse(nx.next) - T0) / 60_000));
      r = { ...r, n: nx.n };
    }
    expect(at).toEqual(FRESH_RETRY_AFTER_MIN.slice(1));
  });
});


describe('the sweep resends through the SAME salon and writes back only that turn', () => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function harness(sendOk: boolean, pageTenant = 'lumio') {
    const turn = { role: 'assistant', content: 'Dạ, hệ thống POS…', at: '2026-10-30T06:35:55.536Z', failed: true, sendError: 'x', retry: { first: '2026-10-30T06:35:55.536Z', n: 0, next: '2026-10-30T06:37:55.536Z', customerAt: '2026-10-30T06:34:45Z' } };
    const thread: Row = { id: 't1', tenantId: 'lumio', pageId: 'P1', senderId: 'S1', status: 'open', handoff: false, handoffMode: null, lastCustomerAt: new Date('2026-10-30T06:34:45Z'), channel: 'messenger', history: [{ role: 'user', content: 'Chi phí?', at: '2026-10-30T06:34:45Z' }, turn] };
    const writes: Row[] = [];
    const sends: Row[] = [];
    const svc = Object.create(MessengerService.prototype) as Row;
    Object.assign(svc, {
      prisma: {
        messengerThread: {
          findMany: jest.fn(async () => [thread]),
          findUnique: jest.fn(async () => ({ history: thread.history })),
          update: jest.fn(async ({ where, data }: Row) => { writes.push({ where, data }); }),
        },
        messengerConnection: { findUnique: jest.fn(async ({ where }: Row) => (where.tenantId === 'lumio' ? { enabled: true } : null)) },
      },
      pageByEntry: jest.fn(async () => ({ pageToken: 'tok-lumio', enabled: true, tenantId: pageTenant })),
      sendText: jest.fn(async (...a: unknown[]) => { sends.push(a); return sendOk ? { ok: true } : { ok: false, retryable: true, error: 'refused', refusal: { code: '10/2018278', meta: 'This message is sent outside of allowed window.', reason: 'x', windowClosed: true } }; }),
      countBotReply: jest.fn(),
      tzOf: jest.fn(async () => 'Asia/Ho_Chi_Minh'),
      events: { publish: jest.fn() },
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    return { svc, writes, sends };
  }
  const due = Date.parse('2026-10-30T06:38:00Z');

  it('delivered on resend: the same text, the turn is no longer failed and says when it went', async () => {
    const { svc, writes, sends } = harness(true);
    expect(await svc.resendRefused(due)).toBe(1);
    expect(sends[0][2]).toBe('Dạ, hệ thống POS…');
    expect(sends[0][0]).toBe('tok-lumio');
    const last = writes[0].data.history.at(-1);
    expect(last).toMatchObject({ failed: false, sendError: null, retry: null });
    expect(last.lateAt).toBeTruthy();
    expect(writes[0].data.history).toHaveLength(2);
  });

  it('refused again: the next time is scheduled and the reason quotes Meta', async () => {
    const { svc, writes } = harness(false);
    await svc.resendRefused(due);
    const last = writes[0].data.history.at(-1);
    expect(last.failed).toBe(true);
    expect(last.retry.n).toBe(1);
    expect(last.sendError).toContain('“This message is sent outside of allowed window.”');
    expect(last.sendError).not.toMatch(/câu chào/);
  });

  it("never uses another salon's Page token", async () => {
    const { svc, sends, writes } = harness(true, 'other-salon');
    expect(await svc.resendRefused(due)).toBe(0);
    expect(sends).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});
