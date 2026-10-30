/**
 * The streaming hotline, wired into the real VoiceService:
 *  - OFF for every line unless its number is listed (VOICE_RELAY_NUMBERS),
 *  - a dropped or refused stream continues the call on the classic engine,
 *  - goodbye / hand-off arrive back from Twilio and are carried out,
 *  - a relay turn only ever reaches its own salon's call.
 */
import { VoiceService } from './voice.service';

process.env.PUBLIC_API_URL = 'https://api.test';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc() {
  const calls: Record<string, Row> = {
    'CA-A': { id: 'ca', callSid: 'CA-A', tenantId: 'ta', fromNumber: '+17145550000', transcript: [{ role: 'user', content: 'hi A' }, { role: 'assistant', content: 'So that is Friday at 2 PM with Kim, is that right?' }], outcome: 'in_progress', language: null },
    'CA-B': { id: 'cb', callSid: 'CA-B', tenantId: 'tb', fromNumber: '+17145551111', transcript: [{ role: 'user', content: 'hi B' }, { role: 'assistant', content: 'Hello B' }], outcome: 'in_progress', language: null },
  };
  const lines: Record<string, Row> = {
    ta: { tenantId: 'ta', lumioNumber: '+17145550100', language: 'en-US', voice: 'Polly.Joanna-Neural', enabled: true, greeting: 'Thanks for calling Salon A!', aiInstruction: '', mode: 'ai', transferNumber: '+17145559999', forwardNumbers: null, ringSeconds: 20 },
    tb: { tenantId: 'tb', lumioNumber: '+17145550200', language: 'en-US', voice: null, enabled: true, greeting: 'Salon B here.', aiInstruction: '', mode: 'ai', transferNumber: null, forwardNumbers: null, ringSeconds: 20 },
  };
  const writes: Row[] = [];
  const prisma = {
    voiceCall: {
      findUnique: async ({ where }: Row) => calls[where.callSid] ?? null,
      update: async (a: Row) => { writes.push(a); return {}; },
      updateMany: async (a: Row) => { writes.push(a); return { count: 1 }; },
    },
    voiceLine: { findUnique: async ({ where }: Row) => lines[where.tenantId] ?? null },
    tenant: { findUnique: async () => ({ name: 'Salon', timezone: 'America/Los_Angeles' }) },
    setting: { findFirst: async () => null },
  };
  const svc = new VoiceService(prisma as never, {} as never, {} as never, {} as never);
  const agentTenants: string[] = [];
  (svc as unknown as { runAgent: unknown }).runAgent = async (tenantId: string, _p: string, _i: string, history: Row[]) => {
    agentTenants.push(`${tenantId}:${history[0]?.content}`);
    return { reply: 'Sure, what day?', done: false, booked: false, appointmentId: null, langSwitch: null };
  };
  return { svc, writes, agentTenants };
}

describe('the streaming hotline is opt-in and fails safe', () => {
  const prev = { n: process.env.VOICE_RELAY_NUMBERS, a: process.env.TWILIO_ACCOUNT_SID };
  afterEach(() => { process.env.VOICE_RELAY_NUMBERS = prev.n; process.env.TWILIO_ACCOUNT_SID = prev.a; if (prev.n === undefined) delete process.env.VOICE_RELAY_NUMBERS; if (prev.a === undefined) delete process.env.TWILIO_ACCOUNT_SID; });

  it('changes nothing for a line that is not listed', async () => {
    delete process.env.VOICE_RELAY_NUMBERS;
    const { svc } = makeSvc();
    const x = await svc.handleLang({ CallSid: 'CA-A', Digits: '1' }, '0');
    expect(x).toContain('<Gather');
    expect(x).not.toContain('ConversationRelay');
    process.env.VOICE_RELAY_NUMBERS = '+17145550200'; // only salon B
    expect(await svc.handleLang({ CallSid: 'CA-A', Digits: '1' }, '0')).toContain('<Gather');
  });

  it("opens the stream for a listed line, in the salon's own voice", async () => {
    process.env.VOICE_RELAY_NUMBERS = '+17145550100';
    const { svc } = makeSvc();
    const x = await svc.handleLang({ CallSid: 'CA-A', Digits: '1' }, '0');
    expect(x).toContain('<ConversationRelay url="wss://api.test/api/voice/relay"');
    expect(x).toContain('welcomeGreeting="Thanks for calling Salon A!"');
    expect(x).toContain('ttsProvider="Amazon" voice="Joanna-Neural"');
    expect(x).toContain('/api/voice/relay-end');
    expect(x).not.toContain('<Gather');
  });

  it('a stream that drops continues the call on the classic engine — and stays there', async () => {
    process.env.VOICE_RELAY_NUMBERS = '+17145550100';
    const { svc } = makeSvc();
    const x = await svc.handleRelayEnd({ CallSid: 'CA-A', SessionStatus: 'failed', ErrorCode: '39001', ErrorMessage: 'Network connection to WebSocket server failed' });
    expect(x).toContain('<Gather');
    expect(x).toContain('/api/voice/turn');
    expect(await svc.handleLang({ CallSid: 'CA-A', Digits: '1' }, '0')).not.toContain('ConversationRelay');
    expect((await svc.relaySetup('CA-A', '')).ok).toBe(false);
  });

  it('carries out the goodbye and the hand-off the stream asked for', async () => {
    process.env.VOICE_RELAY_NUMBERS = '*';
    const { svc } = makeSvc();
    expect(await svc.handleRelayEnd({ CallSid: 'CA-A', SessionStatus: 'ended', HandoffData: '{"do":"hangup"}' })).toContain('<Hangup/>');
    const t = await svc.handleRelayEnd({ CallSid: 'CA-A', SessionStatus: 'ended', HandoffData: '{"do":"transfer","lang":"en-US"}' });
    expect(t).toContain('<Dial');
    expect(t).toContain('+17145559999');
    expect(t).not.toContain('<Say'); // the line was already spoken on the stream
    expect(t).toContain('/api/voice/after-transfer');
    expect(await svc.handleRelayEnd({ CallSid: 'CA-A', SessionStatus: 'completed' })).toContain('<Hangup/>');
  });

  it("refuses a stream from another Twilio account, or for a line that is not on the relay", async () => {
    process.env.VOICE_RELAY_NUMBERS = '+17145550100';
    process.env.TWILIO_ACCOUNT_SID = 'AC_ours';
    const { svc } = makeSvc();
    expect((await svc.relaySetup('CA-A', 'AC_someone_else')).ok).toBe(false);
    expect((await svc.relaySetup('CA-A', 'AC_ours')).ok).toBe(true);
    expect((await svc.relaySetup('CA-B', 'AC_ours')).ok).toBe(false);
    expect((await svc.relaySetup('CA-NOPE', 'AC_ours')).ok).toBe(false);
  });

  it("a relay turn only ever reaches its own salon's call", async () => {
    process.env.VOICE_RELAY_NUMBERS = '*';
    const { svc, agentTenants, writes } = makeSvc();
    const a = await svc.relayTurn('CA-A', 'Friday?');
    const b = await svc.relayTurn('CA-B', 'Saturday?');
    expect(a).toEqual({ kind: 'say', text: 'Sure, what day?', lang: 'en-US', lgFlag: null });
    expect(b.kind).toBe('say');
    expect(agentTenants).toEqual(['ta:hi A', 'tb:hi B']);
    const t = writes.filter((w) => w.data?.transcript);
    expect(t[0].where).toEqual({ id: 'ca' });
    expect(t[1].where).toEqual({ id: 'cb' });
  });

  it('writes down what the caller actually heard when they cut in — on their own call only', async () => {
    const { svc, writes } = makeSvc();
    await svc.relayInterrupted('CA-A', 'So that is Friday at');
    const w = writes.at(-1)!;
    expect(w.where).toEqual({ id: 'ca', tenantId: 'ta' });
    expect(JSON.stringify(w.data.transcript)).toContain('So that is Friday at… (the caller cut in here');
  });
});

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { attachVoiceRelay } from './relay-server';

describe('the relay socket on the API server', () => {
  async function serve(env: Record<string, string | undefined>) {
    const server = createServer();
    const voice = {
      publicApiBase: () => 'https://api.test',
      relaySetup: async () => ({ ok: true, lang: 'en-US', maxSilence: 3 }),
      relayTurn: async (_c: string, speech: string) => ({ kind: 'say', text: `Heard: ${speech}`, lang: 'en-US', lgFlag: null }),
      relaySilence: async () => ({ text: '', end: false, lang: 'en-US' }),
      relayInterrupted: async () => undefined,
      relayFiller: () => 'One moment.',
    };
    attachVoiceRelay(server, voice as never, env);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { server, port: (server.address() as AddressInfo).port };
  }

  it('talks to Twilio end to end: setup, a prompt, the answer', async () => {
    const { server, port } = await serve({ VOICE_RELAY_NUMBERS: '*' });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/relay`);
    await new Promise((r) => { ws.onopen = r; });
    const got = new Promise<Row>((r) => { ws.onmessage = (e) => r(JSON.parse(String(e.data))); });
    ws.send(JSON.stringify({ type: 'setup', callSid: 'CA1', accountSid: 'AC1', customParameters: { lang: 'en-US' } }));
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Friday at two', last: true }));
    expect(await got).toEqual({ type: 'text', token: 'Heard: Friday at two', last: true, lang: 'en-US' });
    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('refuses every connection while the relay is switched off, and unsigned ones when a token is set', async () => {
    for (const env of [{}, { VOICE_RELAY_NUMBERS: '*', TWILIO_AUTH_TOKEN: 'tok' }]) {
      const { server, port } = await serve(env);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/relay`);
      const outcome = await new Promise<string>((r) => { ws.onopen = () => r('open'); ws.onerror = () => r('refused'); });
      expect(outcome).toBe('refused');
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
