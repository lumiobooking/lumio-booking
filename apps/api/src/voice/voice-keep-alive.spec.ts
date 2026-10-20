/**
 * THE HOTLINE NEVER HANGS UP ON ITS OWN.
 *
 * Owners reported calls that ended mid-booking: the model "finished" after
 * an "ok", ran out of tool budget, or took too long. These play Twilio's
 * role against the real service and assert on the TwiML the caller hears.
 */
import { VoiceService } from './voice.service';

process.env.PUBLIC_API_URL = 'https://api.test';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc(opts: { brain?: Row; call?: Row } = {}) {
  const call: Row = { id: 'c1', callSid: 'CA1', tenantId: 't1', fromNumber: '+17145550000', transcript: [], outcome: 'in_progress', language: null, ...opts.call };
  const updates: Row[] = [];
  const prisma = {
    voiceCall: {
      findUnique: async () => call,
      update: async (a: Row) => { updates.push(a); Object.assign(call, a.data ?? {}); return call; },
      updateMany: async () => ({ count: 1 }),
    },
    voiceLine: { findUnique: async () => ({ tenantId: 't1', language: 'en-US', voice: null, enabled: true, greeting: null, aiInstruction: '' }) },
    tenant: { findUnique: async () => ({ name: 'Lux', timezone: 'America/Chicago', contactPhone: null, contactEmail: null, businessType: 'SALON' }) },
    service: { findMany: async () => [] },
    messengerConnection: { findUnique: async () => null },
    setting: { findFirst: async () => null },
  };
  const settings = { getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }) };
  const callbacks: Row[] = [];
  const ends: Row[] = [];
  const brain = {
    getBrain: async () => ({ languages: { primary: 'en', allowed: ['en', 'vi'], voiceOpening: 'auto' }, handoff: { silenceRetries: 3 }, channels: { voice: { greeting: '', extra: '' } }, persona: { greeting: '' }, ...(opts.brain ?? {}) }),
    customerByPhone: async () => null,
    createCallback: async (c: Row) => { callbacks.push(c); return { id: 'cb1' }; },
    endSession: async (t: string, id: string, reason: string) => { ends.push({ t, id, reason }); },
    noteTurn: async () => undefined,
    startSession: async () => 'ses1',
    getMemory: async () => null,
    memoryBlock: () => '',
    touchMemory: async () => undefined,
    distillMemory: async () => undefined,
  };
  const svc = new VoiceService(prisma as never, {} as never, settings as never, {} as never, undefined, undefined, brain as never);
  return { svc, updates, callbacks, ends, call };
}

const agent = (r: Row) => async () => ({ reply: 'Sure.', done: false, booked: false, appointmentId: null, langSwitch: null, ...r });

describe('the hotline stays on the line', () => {
  it('"ok" is not goodbye: the model wanted to end, the caller did not — the line stays open', async () => {
    const { svc, ends } = makeSvc();
    (svc as unknown as Row).runAgent = agent({ reply: 'Thanks for calling, goodbye!', done: true });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'ok' }, '0');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Hangup/>');
    expect(xml).toContain('anything else');
    expect(ends).toEqual([]);
  });

  it('a real goodbye ends the call, logged as such', async () => {
    const { svc, ends } = makeSvc();
    (svc as unknown as Row).runAgent = agent({ reply: 'Thank you, bye!', done: true });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'No that is all, thanks, bye' }, '0');
    expect(xml).toContain('<Hangup/>');
    expect(ends.map((e) => e.reason)).toEqual(['goodbye']);
  });

  it('out of tool budget: a callback task, and the caller is still asked what else — never a goodbye', async () => {
    const { svc, callbacks } = makeSvc();
    (svc as unknown as Row).runAgent = agent({ reply: "I can't finish that part myself, so I've asked a team member to call you back shortly. Is there anything else I can help with?", done: false, stuck: true });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'book 5 people for tomorrow' }, '0');
    expect(xml).toContain('<Gather');
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toEqual(expect.objectContaining({ tenantId: 't1', channel: 'voice', reason: 'tool_loop', phone: '+17145550000' }));
  });

  it('three silences: a callback task for the desk, then a promise to call back — not "I lost you"', async () => {
    const { svc, callbacks, ends } = makeSvc();
    expect(await svc.handleTurn({ CallSid: 'CA1', SpeechResult: '' }, '2')).toContain('<Gather');
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: '' }, '3');
    expect(xml).toContain('<Hangup/>');
    expect(xml).toContain('call you right back');
    expect(callbacks[0]).toEqual(expect.objectContaining({ reason: 'silence' }));
    expect(ends.map((e) => e.reason)).toEqual(['silence']);
  });

  it('an empty first turn on a two-language line listens once in the other language before counting a silence', async () => {
    const { svc, updates } = makeSvc();
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: '' }, '0');
    expect(xml).toContain('<Gather');
    expect(xml).toContain('language="vi-VN"');
    expect(updates.some((u) => JSON.stringify(u).includes('vi-VN'))).toBe(true);
  });

  it('three failures in one call: the desk gets the task and the caller hears a call-back promise', async () => {
    const { svc, callbacks } = makeSvc();
    (svc as unknown as Row).runAgent = async () => { throw new Error('anthropic 529'); };
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'a' }, '0');
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'b' }, '0');
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'c' }, '0');
    expect(xml).toContain('<Hangup/>');
    expect(xml).toContain('call you back');
    expect(callbacks.map((c) => c.reason)).toEqual(['error']);
  });

  it('a slow turn gets a second "still checking" before the caller is asked to repeat', async () => {
    const { svc } = makeSvc();
    const pend = (svc as unknown as { pendingTurns: Map<string, { promise: Promise<string>; at: number }> }).pendingTurns;
    pend.set('CA1-abc', { promise: new Promise(() => undefined), at: Date.now() });
    const origWait = (svc as unknown as Row);
    void origWait;
    // The result endpoint waits RESULT_WAIT_MS; shorten the wait by racing with a stub promise that never settles.
    const p = svc.handleTurnResult({ CallSid: 'CA1' }, 'CA1-abc');
    const xml = await Promise.race([p, new Promise<string>((res) => setTimeout(() => res('timeout'), 13_500))]);
    expect(xml).toContain('<Redirect');
    expect(xml).toContain('turn-result?id=CA1-abc~h1');
    expect(xml).toMatch(/Still checking|Almost there/);
    expect(pend.has('CA1-abc~h1')).toBe(true);
  }, 20_000);
});
