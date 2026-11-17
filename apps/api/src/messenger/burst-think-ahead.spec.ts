/**
 * THINK AHEAD (./burst): where it has been released, the AI starts on a
 * message the moment it lands and the finished reply is held until the
 * customer's pause is over — max(pause, work) instead of pause + work.
 *
 * What must stay true, pinned here:
 *  - a salon it has not been released to waits first and then works, exactly as before;
 *  - a message inside the customer's own pause is the same burst: one answer to all of it;
 *  - nothing that DOES something (a booking, a card, a saved contact) runs
 *    before the pause is over, and not at all when the customer wrote again;
 *  - a run that already did something is never abandoned.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';
import { ABANDONED, MAX_MERGE, MAX_SUPERSEDE, dropKind, holdUntilMs, needsPause } from './burst';

type Row = Record<string, unknown>;
const mocked = chat as unknown as jest.Mock;

describe('think ahead: the rules', () => {
  it('the reply is held until the customer\'s pause is over, counted from their newest message', () => {
    expect(holdUntilMs(10_000, 1_000, 10_200)).toBe(11_000);
    expect(holdUntilMs(undefined, 3_200, 50_000)).toBe(53_200); // no arrival time known: from now
    expect(holdUntilMs(99_999, 1_000, 50_000)).toBe(51_000);    // a clock ahead of us is not trusted
  });

  it('a message inside the pause is the same burst; one after it is a supersede', () => {
    expect(dropKind(10_500, 11_000)).toBe('merge');
    expect(dropKind(11_000, 11_000)).toBe('merge');
    expect(dropKind(12_400, 11_000)).toBe('supersede');
    expect(dropKind(undefined, 11_000)).toBe('supersede');
    expect(MAX_MERGE).toBeGreaterThan(MAX_SUPERSEDE);
  });

  it('only looking is done early; everything that does something waits for the pause', () => {
    for (const t of ['check_availability', 'find_appointment', 'get_services', 'get_pricing', 'quote_price', 'get_software_plans']) expect(needsPause(t)).toBe(false);
    for (const t of ['create_booking', 'reschedule_appointment', 'cancel_appointment', 'save_contact', 'save_lead', 'send_photos', 'send_price_cards', 'send_package_card', 'request_callback', 'save_birthday', 'offer_choices', '']) expect(needsPause(t)).toBe(true);
  });
});

describe('think ahead: the burst loop', () => {
  type Svc = {
    queueReply: (conn: Row, threadId: string, senderId: string, text: string, eventTs?: number, attach?: Row, rid?: string, meta?: Row) => void;
    replyAndRecord: jest.Mock;
  };
  /** A stand-in for the real reply step: works for `workMs`, holds until the pause is over, then is dropped if the customer wrote again. */
  const worker = (workMs: number, sent: string[]) => jest.fn(async (_c: Row, _t: string, _s: string, text: string, _ts: unknown, _a: unknown, _r: unknown, supersede?: () => boolean, ahead?: { until: number }) => {
    await new Promise<void>((r) => { setTimeout(r, workMs); });
    if (ahead && ahead.until > Date.now()) await new Promise<void>((r) => { setTimeout(r, ahead.until - Date.now()); });
    if (supersede?.()) return 'superseded' as const;
    sent.push(text);
    return undefined;
  });
  function build(on: { thinkAhead?: boolean; smartWait?: boolean }) {
    const prisma = { messengerThread: { findUnique: async () => ({ channel: 'messenger', pageId: 'P1' }) } };
    const release = { isOn: (f: keyof typeof on, tenantId: string) => tenantId === 'test-salon' && Boolean(on[f]) };
    return new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      undefined, undefined, undefined, undefined, undefined, undefined, release as never) as unknown as Svc;
  }
  const conn = (tenantId: string) => ({ tenantId, pageToken: 'TOKEN', aiInstruction: null, botFacts: null });
  const meta = { channel: 'messenger', pageId: 'P1' };

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('released: the work starts at once and the reply goes at max(pause, work) — not pause + work', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: true });
    s.replyAndRecord = worker(3500, sent);
    s.queueReply(conn('test-salon'), 'th1', 'P', 'chào shop', Date.now(), {}, undefined, meta); // a greeting: a 3.2 s pause
    await jest.advanceTimersByTimeAsync(20);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);                 // already working
    const ahead = s.replyAndRecord.mock.calls[0][8] as { until: number };
    expect(ahead.until - Date.now()).toBeGreaterThan(3000);            // …and told how long the customer's pause is
    await jest.advanceTimersByTimeAsync(3400);
    expect(sent).toEqual([]);
    await jest.advanceTimersByTimeAsync(200);
    expect(sent).toEqual(['chào shop']);                               // 3.5 s, where waiting first took 6.7 s
  });

  it('released: a reply ready before the pause is over is HELD until it is', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: true });
    s.replyAndRecord = worker(800, sent);
    s.queueReply(conn('test-salon'), 'th2', 'P', 'chào shop', Date.now(), {}, undefined, meta);
    await jest.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([]);
    await jest.advanceTimersByTimeAsync(300);
    expect(sent).toEqual(['chào shop']);
  });

  it('released: messages inside the customer\'s own pause are ONE burst — one answer to all of them, however many', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: true });
    s.replyAndRecord = worker(600, sent);
    const say = (t: string) => s.queueReply(conn('test-salon'), 'th3', 'P', t, Date.now(), {}, undefined, meta);
    say('chào shop');
    for (const t of ['cho mình hỏi', 'giá nối mi', 'với uốn mi', 'bao nhiêu vậy']) { await jest.advanceTimersByTimeAsync(900); say(t); }
    await jest.advanceTimersByTimeAsync(8000);
    expect(sent).toHaveLength(1);                                       // more than MAX_SUPERSEDE messages, still one reply
    for (const t of ['chào shop', 'cho mình hỏi', 'giá nối mi', 'với uốn mi', 'bao nhiêu vậy']) expect(sent[0]).toContain(t);
  });

  it('released: somebody typing without end is still answered (the merge is capped)', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: true });
    s.replyAndRecord = worker(400, sent);
    const say = (t: string) => s.queueReply(conn('test-salon'), 'th4', 'P', t, Date.now(), {}, undefined, meta);
    say('a 1');
    for (let i = 2; i <= 22; i++) { await jest.advanceTimersByTimeAsync(700); say(`a ${i}`); } // fifteen seconds of typing
    expect(sent.length).toBeGreaterThanOrEqual(1);                      // answered while still typing
    await jest.advanceTimersByTimeAsync(10_000);
    expect(sent.join(' ')).toContain('a 22');                           // and nothing they wrote is left unanswered
  });

  it('NOT released: waits first, then works, and the reply step is told nothing about holding — exactly as before', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: true });
    s.replyAndRecord = worker(3500, sent);
    s.queueReply(conn('amys-lash'), 'th5', 'P', 'where are you located?', Date.now(), {}, undefined, meta);
    await jest.advanceTimersByTimeAsync(5900);
    expect(s.replyAndRecord).not.toHaveBeenCalled();                    // the fixed six seconds
    await jest.advanceTimersByTimeAsync(200);
    expect(s.replyAndRecord).toHaveBeenCalledTimes(1);
    expect(s.replyAndRecord.mock.calls[0][8]).toBeUndefined();
    await jest.advanceTimersByTimeAsync(3600);
    expect(sent).toEqual(['where are you located?']);
  });

  it('released without the adaptive wait: the pause is the fixed six seconds, and the work still overlaps it', async () => {
    const sent: string[] = [];
    const s = build({ thinkAhead: true, smartWait: false });
    s.replyAndRecord = worker(3500, sent);
    s.queueReply(conn('test-salon'), 'th6', 'P', 'giá gói marketing', Date.now(), {}, undefined, meta);
    await jest.advanceTimersByTimeAsync(5900);
    expect(sent).toEqual([]);
    await jest.advanceTimersByTimeAsync(200);
    expect(sent).toEqual(['giá gói marketing']);                        // 6 s, not 9.5 s
  });
});

describe('think ahead: inside the AI run, nothing is DONE early', () => {
  const text = (t: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: {} } });
  const tool = (name: string, input: Row = {}) => ({ ok: true, reply: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu-${name}`, name, input }], usage: {} } });
  function build() {
    const prisma = {
      tenant: { findUnique: async () => ({ name: 'Zb Nails', timezone: 'America/Chicago', contactPhone: null, contactEmail: null, businessType: 'SALON', market: 'US' }) },
      setting: { findFirst: async () => null },
      service: { findMany: async () => [] },
    };
    const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never);
    (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
    const ran: string[] = [];
    (s as unknown as { runTool: unknown }).runTool = async (_t: string, _tz: string, name: string) => { ran.push(name); return name === 'create_booking' ? 'SUCCESS: booked' : 'Open: 2:00 PM, 3:00 PM'; };
    return { s: s as unknown as { runAgent: (...a: unknown[]) => Promise<string> }, ran };
  }
  const base = { mode: 'booking', leadEmail: null, channel: 'messenger' };
  const env = { ...process.env };
  beforeEach(() => { mocked.mockReset(); process.env.ANTHROPIC_API_KEY = 'test-placeholder'; delete process.env.ANTHROPIC_HARD_MODEL; });
  afterAll(() => { process.env = env; });

  it('looking in the book happens at once; BOOKING waits for the pause — and does not happen when the customer wrote again', async () => {
    mocked.mockResolvedValueOnce(tool('check_availability')).mockResolvedValueOnce(tool('create_booking')).mockResolvedValue(text('You are all set!'));
    const { s, ran } = build();
    const asked: string[] = [];
    const out = await s.runAgent('t1', '', [], 'yes please book 3pm', { ...base, beforeWrite: async () => { asked.push('pause'); return false; }, abandoned: () => false });
    expect(out).toBe(ABANDONED);
    expect(ran).toEqual(['check_availability']); // looked, never booked
    expect(asked).toEqual(['pause']);            // asked once, for the booking only
    expect(mocked).toHaveBeenCalledTimes(2);     // no third call on a draft nobody will read
  });

  it('the pause is over and the customer said nothing more: the booking goes ahead', async () => {
    mocked.mockResolvedValueOnce(tool('create_booking')).mockResolvedValue(text('You are all set for 3:00 PM!'));
    const { s, ran } = build();
    const out = await s.runAgent('t1', '', [], 'yes please book 3pm', { ...base, beforeWrite: async () => true, abandoned: () => false, booked: { id: 'v1' } });
    expect(ran).toEqual(['create_booking']);
    expect(out).toContain('all set');
  });

  it('the customer wrote again before anything was done: the run stops instead of paying for another model call', async () => {
    mocked.mockResolvedValueOnce(tool('check_availability')).mockResolvedValue(text('2:00 PM is open — shall I book it?'));
    const { s, ran } = build();
    const out = await s.runAgent('t1', '', [], 'do you have 2pm tomorrow', { ...base, beforeWrite: async () => true, abandoned: () => true });
    expect(out).toBe(ABANDONED);
    expect(ran).toEqual(['check_availability']);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('a run that already DID something is never abandoned: the customer must hear what was done', async () => {
    mocked.mockResolvedValueOnce(tool('create_booking')).mockResolvedValue(text('You are all set for 3:00 PM!'));
    const { s, ran } = build();
    let wroteAgain = false;
    const out = await s.runAgent('t1', '', [], 'yes please book 3pm', { ...base, beforeWrite: async () => { wroteAgain = true; return true; }, abandoned: () => wroteAgain, booked: { id: 'v1' } });
    expect(ran).toEqual(['create_booking']);
    expect(out).not.toBe(ABANDONED);
    expect(out).toContain('all set');
  });

  it('without think-ahead nothing is asked and nothing is abandoned (every other salon)', async () => {
    mocked.mockResolvedValueOnce(tool('create_booking')).mockResolvedValue(text('You are all set for 3:00 PM!'));
    const { s, ran } = build();
    const out = await s.runAgent('t1', '', [], 'yes please book 3pm', { ...base, booked: { id: 'v1' } });
    expect(ran).toEqual(['create_booking']);
    expect(out).toContain('all set');
  });
});

describe('think ahead: the reply step holds what is ready', () => {
  type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function makeSvc(agent: () => Promise<string> | string) {
    const thread: R = { id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', senderName: 'Delois', handoff: false, status: 'open', history: [{ role: 'user', content: 'when do you open', at: new Date().toISOString(), rid: 'r1' }] };
    const appended: R[][] = []; const sentAt: number[] = [];
    const prisma = {
      messengerThread: { findUnique: async () => thread, update: async () => thread },
      salesLead: { findFirst: async () => null },
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago', market: 'US' }) },
    };
    const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, { publish: () => undefined } as never, { sendToTenant: async () => undefined } as never);
    const s = svc as unknown as R;
    s.appendTurns = async (_id: string, _h: R[], _m: unknown, turns: R[]) => { appended.push(turns); };
    s.knownCustomerFor = async () => null;
    s.runAgent = async () => agent();
    s.sendText = async () => { sentAt.push(Date.now()); return { ok: true }; };
    s.countBotReply = () => undefined;
    const run = (superseded?: () => boolean, ahead?: { until: number }) => (s.replyAndRecord as (...a: unknown[]) => Promise<void | 'superseded'>).call(
      s, { tenantId: 't1', pageToken: 'TOK', aiInstruction: null, botFacts: [] }, 'th1', 'u1', 'when do you open', Date.now() - 100, {}, ['r1'], superseded, ahead);
    return { run, appended, sentAt };
  }
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('a reply ready early is not sent before the pause is over; the hold is recorded apart from the AI\'s working time', async () => {
    const { run, appended, sentAt } = makeSvc(() => 'We open at 9:00 AM.');
    const t0 = Date.now();
    const done = run(() => false, { until: t0 + 2000 });
    await jest.advanceTimersByTimeAsync(1900);
    expect(sentAt).toEqual([]);
    await jest.advanceTimersByTimeAsync(200);
    await done;
    expect(sentAt).toHaveLength(1);
    expect(sentAt[0] - t0).toBeGreaterThanOrEqual(2000);
    const bot = appended.flat().find((t) => t.role === 'assistant') as R;
    expect(bot.ms.h).toBeGreaterThanOrEqual(1900);
    expect(bot.ms.t).toBeLessThan(500);                         // holding is not the AI working
    for (const k of ['p', 'm', 'j', 'k', 'n', 'r']) expect(typeof bot.ms[k]).toBe('number'); // and the working time is split (./turn-timing)
  });

  it('the customer wrote again during the hold: nothing is sent, and the burst loop is told', async () => {
    const { run, sentAt } = makeSvc(() => 'We open at 9:00 AM.');
    let wroteAgain = false;
    const done = run(() => wroteAgain, { until: Date.now() + 2000 });
    await jest.advanceTimersByTimeAsync(800);
    wroteAgain = true;
    await jest.advanceTimersByTimeAsync(1500);
    expect(await done).toBe('superseded');
    expect(sentAt).toEqual([]);
  });

  it('a run that stopped itself for a newer message sends nothing', async () => {
    const { run, sentAt, appended } = makeSvc(() => ABANDONED);
    const done = run(() => true, { until: Date.now() + 1000 });
    await jest.advanceTimersByTimeAsync(1500);
    expect(await done).toBe('superseded');
    expect(sentAt).toEqual([]);
    expect(appended.flat().some((t) => t.role === 'assistant')).toBe(false);
  });

  it('without think-ahead the reply goes the moment it is ready, and carries no hold', async () => {
    const { run, sentAt, appended } = makeSvc(() => 'We open at 9:00 AM.');
    const t0 = Date.now();
    const done = run(() => false);
    await jest.advanceTimersByTimeAsync(50);
    await done;
    expect(sentAt).toHaveLength(1);
    expect(sentAt[0] - t0).toBeLessThan(50);
    const bot = appended.flat().find((t) => t.role === 'assistant') as R;
    expect(bot.ms.h).toBeUndefined();
  });
});
