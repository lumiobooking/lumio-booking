/**
 * The WHOLE bilingual call, simulated turn by turn.
 *
 * Every bug this feature shipped was found by a human dialing a real phone:
 * the alice voice, the lost keypress, the "a lô" menu loop, the English
 * greeting after pressing 2. Each fix was blind until the next call. This
 * spec ends that: it plays Twilio's role — posting digits, speech, silence
 * and agent failures into the real service methods — and asserts on the
 * actual TwiML a caller's phone would receive.
 */
import { VoiceService } from './voice.service';

process.env.PUBLIC_API_URL = 'https://api.test';

interface Calls { updates: Record<string, unknown>[] }

function makeSvc(overrides: { line?: Record<string, unknown>; call?: Record<string, unknown> } = {}): { svc: VoiceService; io: Calls } {
  const io: Calls = { updates: [] };
  const call = {
    id: 'c1', callSid: 'CA1', tenantId: 't1', fromNumber: '+17145550000',
    transcript: [], outcome: 'in_progress', language: null,
    ...overrides.call,
  };
  const line = {
    tenantId: 't1', language: 'bilingual', voice: null, enabled: true,
    greeting: 'Thanks for calling Family Smart Homes! How can we help with your real estate needs?',
    aiInstruction: '', ...overrides.line,
  };
  const prisma = {
    voiceCall: {
      findUnique: async () => call,
      update: async (args: Record<string, unknown>) => { io.updates.push(args); return call; },
      updateMany: async () => ({ count: 1 }),
    },
    voiceLine: { findUnique: async () => line },
    tenant: { findUnique: async () => ({ name: 'Family Smart Homes', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'REAL_ESTATE' }) },
    service: { findMany: async () => [{ id: 's1', name: 'Consultation call', priceCents: 0, durationMinutes: 30, currency: 'USD' }] },
    messengerConnection: { findUnique: async () => null },
    setting: { findFirst: async () => null },
  };
  const settings = { getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }) };
  const svc = new VoiceService(prisma as never, {} as never, settings as never, {} as never);
  return { svc, io };
}

const agentOk = async () => ({ reply: 'Dạ em nghe đây ạ, anh chị muốn hẹn tư vấn lúc nào ạ?', done: false, booked: false, appointmentId: null, langSwitch: null });

describe('the opening menu', () => {
  it('is KEYPAD-ONLY with both languages in their own voices — talk cannot hijack it', () => {
    const { svc } = makeSvc();
    const xml = (svc as unknown as { langMenuTwiml: (n: string, m: number) => string }).langMenuTwiml('Family Smart Homes', 0);
    expect(xml).toContain('input="dtmf"');
    expect(xml).not.toContain('speechTimeout');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('press 1');
    expect(xml).toContain('nhấn phím 2');
    expect(xml).toContain('Polly.Joanna-Neural');
    expect(xml).toContain('Google.vi-VN-Wavenet-A');
    expect(xml).toContain('/api/voice/lang?miss=0');
    expect(xml).toContain('/api/voice/lang?miss=1');
  });
});

describe('pressing 2 — the exact key the owner pressed on every failed test call', () => {
  it('greets in VIETNAMESE, with a Vietnamese voice, and listens in Vietnamese', async () => {
    const { svc, io } = makeSvc();
    const xml = await svc.handleLang({ CallSid: 'CA1', Digits: '2' }, '0');
    expect(xml).toContain('Xin chào');
    expect(xml).toContain('Family Smart Homes');
    expect(xml).toContain('Google.vi-VN-Wavenet-A');
    expect(xml).toContain('language="vi-VN"');
    // the ENGLISH configured greeting must NOT leak into the Vietnamese branch
    expect(xml).not.toContain('real estate needs');
    // the choice rides the webhook URL — surviving even a failed DB write
    expect(xml).toContain('lg=vi-VN');
    // and is persisted for good measure
    expect(io.updates.some((u) => JSON.stringify(u).includes('vi-VN'))).toBe(true);
  });

  it('pressing 1 keeps the salon’s own English greeting', async () => {
    const { svc } = makeSvc();
    const xml = await svc.handleLang({ CallSid: 'CA1', Digits: '1' }, '0');
    expect(xml).toContain('real estate needs');
    expect(xml).toContain('language="en-US"');
    expect(xml).toContain('lg=en-US');
  });

  it('silence replays the menu at most twice, then defaults to English', async () => {
    const { svc } = makeSvc();
    const replay = await svc.handleLang({ CallSid: 'CA1' }, '0');
    expect(replay).toContain('/api/voice/lang?miss=1'); // menu again, counted
    const fallback = await svc.handleLang({ CallSid: 'CA1' }, '2');
    expect(fallback).toContain('language="en-US"'); // gave up → English call
  });
});

describe('a Vietnamese conversation turn', () => {
  it('replies and keeps listening in Vietnamese even when the DB lost the choice', async () => {
    const { svc } = makeSvc(); // call.language is NULL — only ?lg carries it
    (svc as unknown as { runAgent: unknown }).runAgent = agentOk;
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'tôi muốn hẹn tư vấn' }, '0', 'vi-VN');
    expect(xml).toContain('Dạ em nghe đây ạ');
    expect(xml).toContain('language="vi-VN"');
    expect(xml).toContain('Google.vi-VN-Wavenet-A');
    expect(xml).toContain('lg=vi-VN');
  });

  it('a configured ENGLISH line voice cannot read the Vietnamese turn', async () => {
    const { svc } = makeSvc({ line: { voice: 'Polly.Joanna-Neural' } });
    (svc as unknown as { runAgent: unknown }).runAgent = agentOk;
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'alo' }, '0', 'vi-VN');
    expect(xml).toContain('Google.vi-VN-Wavenet-A');
    expect(xml).not.toContain('<Say voice="Polly.Joanna-Neural" language="vi-VN"');
  });

  it('one agent failure = a Vietnamese "say that again", NEVER a goodbye', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { runAgent: unknown }).runAgent = async () => { throw new Error('boom'); };
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'giá bao nhiêu' }, '0', 'vi-VN');
    expect(xml).toContain('em xử lý hơi chậm');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Hangup/>');
    expect(xml).not.toMatch(/Sorry/);
  });

  it('only the THIRD failure in one call earns a goodbye — in Vietnamese', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { runAgent: unknown }).runAgent = async () => { throw new Error('boom'); };
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'a' }, '0', 'vi-VN');
    await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'b' }, '0', 'vi-VN');
    const third = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'c' }, '0', 'vi-VN');
    expect(third).toContain('<Hangup/>');
    expect(third).toContain('trục trặc');
    expect(third).not.toMatch(/Sorry/);
  });

  it('silence twice ends the call politely in Vietnamese', async () => {
    const { svc } = makeSvc({ call: { language: 'vi-VN' } });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: '' }, '2');
    expect(xml).toContain('<Hangup/>');
    expect(xml).toContain('mất tín hiệu');
  });

  it('the agent can switch the call to Vietnamese mid-conversation (menu failed → rescue)', async () => {
    const { svc, io } = makeSvc(); // no language chosen anywhere → English turn
    (svc as unknown as { runAgent: unknown }).runAgent = async () => ({ reply: 'Dạ, em chuyển sang tiếng Việt ạ.', done: false, booked: false, appointmentId: null, langSwitch: 'vi-VN' });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'toi noi tieng viet duoc khong' }, '0');
    // the very reply is spoken AND the next listen runs in Vietnamese
    expect(xml).toContain('language="vi-VN"');
    expect(xml).toContain('lg=vi-VN');
    expect(io.updates.some((u) => JSON.stringify(u).includes('vi-VN'))).toBe(true);
  });
});

describe('an English conversation turn stays exactly English', () => {
  it('monolingual lines never grow menu behaviour or Vietnamese strings', async () => {
    const { svc } = makeSvc({ line: { language: 'en-US' } });
    (svc as unknown as { runAgent: unknown }).runAgent = async () => ({ reply: 'Sure, what time works for you?', done: false, booked: false, appointmentId: null, langSwitch: null });
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'book me in' }, '0');
    expect(xml).toContain('language="en-US"');
    expect(xml).not.toContain('lg=');
    expect(xml).not.toContain('vi-VN');
  });
});


// ---- the REAL brain, with Anthropic faked at the network edge ---------------
// Every earlier spec stubbed runAgent, so a crash or a hangup-on-error INSIDE
// it was invisible until a live caller hit it ("sorry và tắt máy"). These run
// the genuine method; only fetch is fake.
describe('the real runAgent under real failure', () => {
  const okResponse = {
    ok: true,
    json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Dạ, em có thể xếp lịch tư vấn cho anh chị ạ.' }] }),
  } as Response;
  const err = (status: number) => ({ ok: false, status, text: async () => 'err' }) as Response;
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; fetchSpy = jest.spyOn(globalThis, 'fetch' as never); });
  afterEach(() => { fetchSpy.mockRestore(); delete process.env.ANTHROPIC_API_KEY; });

  it('a healthy reply flows end-to-end through persona + bilingual prompt building', async () => {
    const { svc } = makeSvc();
    fetchSpy.mockResolvedValue(okResponse as never);
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'tôi muốn tư vấn mua nhà' }, '0', 'vi-VN');
    expect(xml).toContain('xếp lịch tư vấn');
    expect(xml).toContain('language="vi-VN"');
  });

  it('Anthropic 401 (bad key) = Vietnamese "say that again", NOT an English goodbye hangup', async () => {
    const { svc } = makeSvc();
    fetchSpy.mockResolvedValue(err(401) as never);
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'giá bao nhiêu' }, '0', 'vi-VN');
    expect(xml).toContain('em xử lý hơi chậm');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Hangup/>');
    expect(xml).not.toMatch(/Sorry, I am having trouble/);
  });

  it('a MISSING key also stays alive in the caller’s language (and screams in the log)', async () => {
    const { svc } = makeSvc();
    delete process.env.ANTHROPIC_API_KEY;
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'alo' }, '0', 'vi-VN');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('Thank you for calling');
  });

  it('529 overloaded: one quiet retry, then the reply — the caller never knows', async () => {
    const { svc } = makeSvc();
    fetchSpy.mockResolvedValueOnce(err(529) as never).mockResolvedValueOnce(okResponse as never);
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'hẹn thứ ba được không' }, '0', 'vi-VN');
    expect(xml).toContain('xếp lịch tư vấn');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});


// ---- the database itself failing must NEVER become a Twilio 500 -------------
// A missing column (the failed voice_calls.language migration) made
// findUnique throw on EVERY /lang and /turn: NestJS 500 → Twilio's own
// English "application error" + instant hangup. The webhook must always
// answer with TwiML, whatever the DB does.
describe('a broken database still answers the phone', () => {
  it('/lang: read explodes → polite TwiML, not an exception', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { prisma: { voiceCall: { findUnique: unknown } } }).prisma.voiceCall.findUnique =
      async () => { throw new Error('column voice_calls.language does not exist'); };
    const xml = await svc.handleLang({ CallSid: 'CA1', Digits: '2' }, '0');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Hangup/>');
  });

  it('/turn: read explodes → polite TwiML, not an exception', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { prisma: { voiceCall: { findUnique: unknown } } }).prisma.voiceCall.findUnique =
      async () => { throw new Error('column voice_calls.language does not exist'); };
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'alo' }, '0', 'vi-VN');
    expect(xml).toContain('<Response>');
  });
});


// ---- every TwiML document must be REAL XML --------------------------------
// The killer bug the whole saga came down to: ?miss=1&lg=vi-VN put a naked
// ampersand inside the document → Twilio error 12100 "Document parse
// failure" → its own English apology + hangup, on exactly the turns that
// carried the language parameter. String asserts never caught it; this does.
describe('TwiML is valid XML — no naked ampersands, ever', () => {
  const NAKED_AMP = /&(?!amp;|lt;|gt;|quot;|apos;|#)/;
  it('the exact response that killed the pressed-2 call is clean', async () => {
    const { svc } = makeSvc();
    const xml = await svc.handleLang({ CallSid: 'CA1', Digits: '2' }, '0');
    expect(xml).not.toMatch(NAKED_AMP);
    expect(xml).toContain('&amp;lg=vi-VN'); // the redirect carries both params, escaped
  });
  it('a Vietnamese turn reply is clean too', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { runAgent: unknown }).runAgent = agentOk;
    const xml = await svc.handleTurn({ CallSid: 'CA1', SpeechResult: 'alo' }, '0', 'vi-VN');
    expect(xml).not.toMatch(NAKED_AMP);
  });
  it('menu, English turns and hangups are clean', async () => {
    const { svc } = makeSvc();
    (svc as unknown as { runAgent: unknown }).runAgent = agentOk;
    const menu = (svc as unknown as { langMenuTwiml: (n: string, m: number) => string }).langMenuTwiml('A & B Nails', 0);
    expect(menu).not.toMatch(NAKED_AMP);
    const en = await svc.handleLang({ CallSid: 'CA1', Digits: '1' }, '0');
    expect(en).not.toMatch(NAKED_AMP);
  });
});
