import { createHmac } from 'crypto';
import {
  RELAY_FILLER_MS, RELAY_SILENCE_MS, RelaySession, relayEnabledFor, relaySignatureOk, relayTwiml, speakMs, ttsFor,
  type RelayDeps,
} from './relay';
import type { TurnAction } from './voice.service';

describe('relay switches', () => {
  it('is off for every number unless listed', () => {
    expect(relayEnabledFor('+17145550000', {})).toBe(false);
    expect(relayEnabledFor('+17145550000', { VOICE_RELAY_NUMBERS: '+1 (714) 555-0000, +18005550100' })).toBe(true);
    expect(relayEnabledFor('+17145559999', { VOICE_RELAY_NUMBERS: '+17145550000' })).toBe(false);
    expect(relayEnabledFor('+17145559999', { VOICE_RELAY_NUMBERS: '*' })).toBe(true);
    expect(relayEnabledFor(null, { VOICE_RELAY_NUMBERS: '+17145550000' })).toBe(false);
  });

  it("keeps the salon's chosen voice, or Twilio's default", () => {
    expect(ttsFor('Polly.Joanna-Neural', {})).toEqual({ ttsProvider: 'Amazon', voice: 'Joanna-Neural' });
    expect(ttsFor('Google.vi-VN-Wavenet-A', {})).toEqual({ ttsProvider: 'Google', voice: 'vi-VN-Wavenet-A' });
    expect(ttsFor('Polly.Nicole', {})).toEqual({});
    expect(ttsFor(null, {})).toEqual({});
    expect(ttsFor('Polly.Joanna-Neural', { VOICE_RELAY_TTS: 'elevenlabs' })).toEqual({});
  });

  it('opens the stream with the greeting, escaped, and both languages of a bilingual line', () => {
    const x = relayTwiml({
      apiBase: 'https://api.test/', greeting: 'Hi! Amy\'s Lash & Brows <3', lang: 'en-US',
      langs: [{ code: 'en-US', tts: { ttsProvider: 'Amazon', voice: 'Joanna-Neural' } }, { code: 'vi-VN', tts: { ttsProvider: 'Google', voice: 'vi-VN-Wavenet-A' } }],
    });
    expect(x).toContain('<Connect action="https://api.test/api/voice/relay-end" method="POST">');
    expect(x).toContain('url="wss://api.test/api/voice/relay"');
    expect(x).toContain('welcomeGreeting="Hi! Amy&apos;s Lash &amp; Brows &lt;3"');
    expect(x).toContain('<Language code="vi-VN" ttsProvider="Google" voice="vi-VN-Wavenet-A"/>');
    expect(x).toContain('language="en-US" ttsProvider="Amazon" voice="Joanna-Neural"');
  });

  it('accepts only a Twilio-signed wss upgrade', () => {
    const env = { TWILIO_AUTH_TOKEN: 'tok' };
    const sig = createHmac('sha1', 'tok').update('wss://api.test/api/voice/relay').digest('base64');
    expect(relaySignatureOk({ apiBase: 'https://api.test', path: '/api/voice/relay', signature: sig }, env)).toBe(true);
    expect(relaySignatureOk({ apiBase: 'https://api.test', path: '/api/voice/relay', signature: 'nope' }, env)).toBe(false);
    expect(relaySignatureOk({ apiBase: 'https://api.test', path: '/api/voice/relay', signature: undefined }, env)).toBe(false);
    // signed over https:// (the webhook form) is not the same thing
    const httpsSig = createHmac('sha1', 'tok').update('https://api.test/api/voice/relay').digest('base64');
    expect(relaySignatureOk({ apiBase: 'https://api.test', path: '/api/voice/relay', signature: httpsSig }, env)).toBe(false);
  });

  it('estimates speaking time, capped', () => {
    expect(speakMs('Goodbye!')).toBeGreaterThan(600);
    expect(speakMs('x'.repeat(10_000))).toBe(15_000);
  });
});

describe('RelaySession — one call over the socket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function harness(over: Partial<RelayDeps> = {}) {
    const sent: Record<string, unknown>[] = [];
    let turnImpl: (speech: string, interim: (t: string) => void) => Promise<TurnAction> = async (speech) => ({ kind: 'say', text: `You said ${speech}.`, lang: 'en-US', lgFlag: null });
    const deps: RelayDeps = {
      send: (m) => sent.push(m),
      close: () => undefined,
      setup: async () => ({ ok: true, lang: 'en-US', maxSilence: 2 }),
      turn: (_c, s, i) => turnImpl(s, i),
      silence: async (_c, misses) => (misses >= 2 ? { text: 'We will call you back. Goodbye.', end: true, lang: 'en-US' } : { text: 'Sorry, I did not catch that.', end: false, lang: 'en-US' }),
      interrupted: jest.fn(async () => undefined),
      filler: (_l, n) => (n === 0 ? 'One moment.' : n > 0 ? 'Still checking.' : 'Say that again?'),
      log: () => undefined,
      ...over,
    };
    const s = new RelaySession(deps);
    return { s, sent, deps, setTurn: (f: typeof turnImpl) => { turnImpl = f; } };
  }
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const setup = (s: RelaySession) => s.onMessage(JSON.stringify({ type: 'setup', callSid: 'CA1', accountSid: 'AC1', customParameters: { lang: 'en-US' } }));
  const prompt = (s: RelaySession, words: string) => s.onMessage(JSON.stringify({ type: 'prompt', voicePrompt: words, last: true, lang: 'en-US' }));

  it('holds anything that arrives before setup until setup is answered, then answers each finished utterance', async () => {
    const { s, sent } = harness();
    const early = prompt(s, 'too early');
    await flush();
    expect(sent).toHaveLength(0);
    await setup(s);
    await early;
    expect(sent).toEqual([{ type: 'text', token: 'You said too early.', last: true, lang: 'en-US' }]);
    sent.length = 0;
    await prompt(s, 'Friday at 2');
    expect(sent).toEqual([{ type: 'text', token: 'You said Friday at 2.', last: true, lang: 'en-US' }]);
    await s.onMessage(JSON.stringify({ type: 'prompt', voicePrompt: 'partial', last: false }));
    expect(sent).toHaveLength(1);
  });

  it('a refused setup ends the stream so the call falls back to the classic engine', async () => {
    const { s, sent } = harness({ setup: async () => ({ ok: false, lang: 'en-US', maxSilence: 3 }) });
    await setup(s);
    expect(sent).toEqual([{ type: 'end', handoffData: JSON.stringify({ do: 'fallback' }) }]);
    await prompt(s, 'hello');
    expect(sent).toHaveLength(1);
  });

  it('says "one moment" when the brain is slow, and speaks early words at once', async () => {
    const { s, sent, setTurn } = harness();
    await setup(s);
    let finish!: (a: TurnAction) => void;
    setTurn((_w, interim) => new Promise((r) => { finish = r; setTimeout(() => interim('Let me look.'), 100); }));
    const run = prompt(s, 'is Tuesday open');
    await flush();
    jest.advanceTimersByTime(100);
    expect(sent.at(-1)).toEqual({ type: 'text', token: 'Let me look. ', last: false, lang: 'en-US' });
    jest.advanceTimersByTime(RELAY_FILLER_MS);
    expect(sent.filter((m) => m.token === 'One moment. ')).toHaveLength(0); // already said something
    finish({ kind: 'say', text: 'Tuesday at two is open.', lang: 'en-US', lgFlag: null });
    await run;
    expect(sent.at(-1)).toEqual({ type: 'text', token: 'Tuesday at two is open.', last: true, lang: 'en-US' });
  });

  it('fills a silent wait', async () => {
    const { s, sent, setTurn } = harness();
    await setup(s);
    let finish!: (a: TurnAction) => void;
    setTurn(() => new Promise((r) => { finish = r; }));
    const run = prompt(s, 'book me');
    await flush();
    jest.advanceTimersByTime(RELAY_FILLER_MS + 1);
    expect(sent.at(-1)).toEqual({ type: 'text', token: 'One moment. ', last: false, lang: 'en-US' });
    finish({ kind: 'say', text: 'Done.', lang: 'en-US', lgFlag: null });
    await run;
  });

  it('switches language before speaking in it', async () => {
    const { s, sent, setTurn } = harness();
    await setup(s);
    setTurn(async () => ({ kind: 'say', text: 'Dạ em nghe ạ.', lang: 'vi-VN', lgFlag: 'vi-VN' }));
    await prompt(s, 'tieng viet');
    expect(sent).toEqual([
      { type: 'language', ttsLanguage: 'vi-VN', transcriptionLanguage: 'vi-VN' },
      { type: 'text', token: 'Dạ em nghe ạ.', last: true, lang: 'vi-VN' },
    ]);
  });

  it('hangs up and hands off only AFTER the line has been spoken', async () => {
    const { s, sent, setTurn } = harness();
    await setup(s);
    setTurn(async () => ({ kind: 'hangup', text: 'Thanks for calling, goodbye!', lang: 'en-US' }));
    await prompt(s, 'that is all, bye');
    expect(sent.some((m) => m.type === 'end')).toBe(false);
    jest.advanceTimersByTime(speakMs('Thanks for calling, goodbye!'));
    expect(sent.at(-1)).toEqual({ type: 'end', handoffData: JSON.stringify({ do: 'hangup' }) });

    const h2 = harness();
    await setup(h2.s);
    h2.setTurn(async () => ({ kind: 'transfer', text: 'Connecting you now.', lang: 'en-US', lgFlag: null, humans: ['+1'] }));
    await prompt(h2.s, 'a real person please');
    jest.advanceTimersByTime(speakMs('Connecting you now.'));
    expect(h2.sent.at(-1)).toEqual({ type: 'end', handoffData: JSON.stringify({ do: 'transfer', lang: 'en-US' }) });
  });

  it('asks again on silence, then promises a call back and closes', async () => {
    const { s, sent } = harness();
    await setup(s);
    jest.advanceTimersByTime(4_000 + RELAY_SILENCE_MS + 1);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'text', token: 'Sorry, I did not catch that.' });
    jest.advanceTimersByTime(speakMs('Sorry, I did not catch that.') + RELAY_SILENCE_MS + 1);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'text', token: 'We will call you back. Goodbye.' });
    jest.advanceTimersByTime(speakMs('We will call you back. Goodbye.') + 1);
    expect(sent.at(-1)).toEqual({ type: 'end', handoffData: JSON.stringify({ do: 'hangup' }) });
  });

  it('records what the caller actually heard when they cut in, before the next turn reads it', async () => {
    const order: string[] = [];
    const { s, setTurn } = harness({ interrupted: async () => { order.push('fix'); } });
    await setup(s);
    setTurn(async () => { order.push('turn'); return { kind: 'say', text: 'ok', lang: 'en-US', lgFlag: null }; });
    await s.onMessage(JSON.stringify({ type: 'interrupt', utteranceUntilInterrupt: 'So that is Friday at', durationUntilInterruptMs: 900 }));
    await prompt(s, 'no, Saturday');
    expect(order).toEqual(['fix', 'turn']);
  });

  it('merges words said while the brain was still busy into the next turn', async () => {
    const { s, setTurn } = harness();
    await setup(s);
    const seen: string[] = [];
    let release!: () => void;
    setTurn(async (w) => { seen.push(w); if (seen.length === 1) await new Promise<void>((r) => { release = r; }); return { kind: 'say', text: 'ok', lang: 'en-US', lgFlag: null }; });
    const first = prompt(s, 'gel manicure');
    await flush();
    await prompt(s, 'and a pedicure');
    await prompt(s, 'for two');
    release();
    await first;
    expect(seen).toEqual(['gel manicure', 'and a pedicure for two']);
  });
});
