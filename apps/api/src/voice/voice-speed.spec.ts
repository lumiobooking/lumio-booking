/**
 * The hotline answers faster:
 *  - the salon is read once per CALL, not once per turn (call-cache.ts),
 *  - the prompt's salon part is identical turn after turn, so the model API
 *    serves it from cache (the clock and the caller ride in a second part),
 *  - the owner-instruction judge only runs when the caller's words triggered
 *    an instruction,
 * and none of it ever lets one salon's call see another salon's data.
 */
import { VoiceService, speechAttrs } from './voice.service';
import { CallCache } from './call-cache';
import { AiInstructionsService } from '../ai-brain/instructions.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc(opts: { instructions?: Row[] } = {}) {
  const reads: string[] = [];
  const menus: Record<string, Row[]> = {
    ta: [{ id: 'a1', name: 'Gel Manicure A', priceCents: 4000, durationMinutes: 45, currency: 'USD' }],
    tb: [{ id: 'b1', name: 'Lash Lift B', priceCents: 9000, durationMinutes: 60, currency: 'USD' }],
  };
  const prisma = {
    voiceCall: { findUnique: async () => null, update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    voiceLine: { findUnique: async () => null },
    tenant: { findUnique: async ({ where }: Row) => { reads.push(`tenant:${where.id}`); return { name: `Salon ${where.id}`, timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'SALON' }; } },
    service: { findMany: async ({ where }: Row) => { reads.push(`service:${where.tenantId}`); return menus[where.tenantId] ?? []; } },
    serviceAddon: { findMany: async () => [] },
    staffMember: { findMany: async () => [] },
    messengerConnection: { findUnique: async () => null },
    setting: { findFirst: async () => null },
  };
  const settings = { getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }), getAiNotes: async () => ({ text: '' }) };
  const rows = opts.instructions ?? [];
  const db = { aiInstruction: { findMany: async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId), updateMany: async () => ({ count: 1 }) } };
  const instructions = new AiInstructionsService(db as never, { log: async () => undefined } as never);
  const svc = new VoiceService(prisma as never, {} as never, settings as never, {} as never, undefined, undefined, undefined, instructions);
  return { svc: svc as unknown as { runAgent: (...a: unknown[]) => Promise<{ reply: string; timing?: Row }> }, reads };
}

describe('the hotline turn is fast', () => {
  let fetchSpy: jest.SpyInstance;
  const said = (text: string) => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 40, cache_read_input_tokens: 5000 } }) }) as Response;
  const bodies = () => fetchSpy.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { system?: { text: string; cache_control?: unknown }[] });
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; fetchSpy = jest.spyOn(globalThis, 'fetch' as never); fetchSpy.mockResolvedValue(said('Sure, what day works?') as never); });
  afterEach(() => { fetchSpy.mockRestore(); delete process.env.ANTHROPIC_API_KEY; });

  it('reads the salon once per call, not once per turn', async () => {
    const { svc, reads } = makeSvc();
    await svc.runAgent('ta', '+17145550000', '', [], 'I want a manicure', 'en-US', false, false, null, 'CA-1');
    const afterFirst = reads.length;
    expect(afterFirst).toBeGreaterThan(0);
    await svc.runAgent('ta', '+17145550000', '', [{ role: 'user', content: 'I want a manicure' }, { role: 'assistant', content: 'Sure, what day works?' }], 'Friday', 'en-US', false, false, null, 'CA-1');
    expect(reads.length).toBe(afterFirst); // the second turn reads nothing about the salon
    expect(reads.filter((r) => r === 'service:ta')).toHaveLength(1);
  });

  it('keeps the cached salon part byte-identical across turns; the clock and caller ride in the second part', async () => {
    const { svc } = makeSvc();
    await svc.runAgent('ta', '+17145550000', '', [], 'hi', 'en-US', false, false, null, 'CA-2');
    await svc.runAgent('ta', '+17145551234', '', [], 'hi again', 'en-US', false, false, 'appt-1', 'CA-3');
    const [a, b] = bodies();
    expect(a.system![0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a.system![0].text).toBe(b.system![0].text);
    expect(a.system![0].text).not.toMatch(/0000|1234/);
    expect(a.system![1].text).toContain('ending in 0, 0, 0, 0');
    expect(b.system![1].text).toContain('ending in 1, 2, 3, 4');
    expect(b.system![1].text).toContain('booking was already made');
    expect(a.system![1].text).toMatch(/local time right now/);
  });

  it("never hands one salon's menu to another salon's call, even on the same call sid", async () => {
    const { svc } = makeSvc();
    await svc.runAgent('ta', '+17145550000', '', [], 'hi', 'en-US', false, false, null, 'CA-SAME');
    await svc.runAgent('tb', '+17145550000', '', [], 'hi', 'en-US', false, false, null, 'CA-SAME');
    const [a, b] = bodies();
    expect(a.system![0].text).toContain('Gel Manicure A');
    expect(a.system![0].text).not.toContain('Lash Lift B');
    expect(b.system![0].text).toContain('Lash Lift B');
    expect(b.system![0].text).not.toContain('Gel Manicure A');
  });

  it('reports where the time went', async () => {
    const { svc } = makeSvc();
    const r = await svc.runAgent('ta', '+17145550000', '', [], 'hi', 'en-US', false, false, null, 'CA-4');
    expect(r.timing).toMatchObject({ modelMs: [expect.any(Number)], cacheRead: 5000, uncached: 40 });
  });

  it('does not run the instruction judge on a turn no instruction was triggered by', async () => {
    const rule = { id: 'r1', tenantId: 'ta', kind: 'never', text: 'Never promise a discount.', triggers: ['discount'], mode: 'meaning', channels: ['voice'], on: true, createdAt: new Date(1), meaning: 'Never promise a discount.' };
    const { svc } = makeSvc({ instructions: [rule] });
    await svc.runAgent('ta', '+17145550000', '', [], 'can I come Friday at 2?', 'en-US', false, false, null, 'CA-5');
    const judged = fetchSpy.mock.calls.some((c) => String((c[1] as RequestInit).body).includes('You check ONE reply'));
    expect(judged).toBe(false);
  });
});

describe('CallCache', () => {
  it('loads once, keys by tenant AND call, and never remembers a failure', async () => {
    const c = new CallCache();
    let n = 0;
    const load = async () => ++n;
    expect(await c.get('ta', 'CA', 'x', load)).toBe(1);
    expect(await c.get('ta', 'CA', 'x', load)).toBe(1);
    expect(await c.get('tb', 'CA', 'x', load)).toBe(2);
    await expect(c.get('ta', 'CB', 'y', async () => { throw new Error('db down'); })).rejects.toThrow();
    expect(await c.get('ta', 'CB', 'y', async () => 'ok')).toBe('ok');
    c.dropCall('CA');
    expect(await c.get('ta', 'CA', 'x', load)).toBe(3);
    expect(await c.get('ta', null, 'x', load)).toBe(4); // no call sid → never cached
  });
});

describe('speechAttrs — how Twilio listens', () => {
  it('is exactly what it always was when nothing is set', () => {
    expect(speechAttrs('en-US', {})).toBe(' speechTimeout="auto"');
    expect(speechAttrs('vi-VN', {})).toBe(' speechTimeout="auto"');
  });
  it('uses a named recogniser per language, always with a numeric timeout', () => {
    const env = { VOICE_SPEECH_MODEL: 'deepgram_nova-3' };
    expect(speechAttrs('en-US', env)).toBe(' speechModel="deepgram_nova-3" speechTimeout="1"');
    expect(speechAttrs('vi-VN', env)).toBe(' speechTimeout="auto"');
    expect(speechAttrs('vi-VN', { VOICE_SPEECH_MODEL_VI: 'googlev2_telephony', VOICE_SPEECH_TIMEOUT: '2' })).toBe(' speechModel="googlev2_telephony" speechTimeout="2"');
  });
  it('ignores a malformed value instead of breaking the call', () => {
    expect(speechAttrs('en-US', { VOICE_SPEECH_MODEL: 'x" onload="1' })).toBe(' speechTimeout="auto"');
  });
});
