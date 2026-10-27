/**
 * The hotline obeys the owner's instructions: in the prompt above everything,
 * and a line that breaks one is replaced before it is spoken.
 */
import { VoiceService } from './voice.service';
import { AiInstructionsService } from '../ai-brain/instructions.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc(rows: Row[]) {
  const prisma = {
    voiceCall: { findUnique: async () => null, update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    voiceLine: { findUnique: async () => null },
    tenant: { findUnique: async () => ({ name: 'An Sen', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'SPA' }) },
    service: { findMany: async () => [{ id: 's1', name: 'Signature Ritual', priceCents: 18000, durationMinutes: 90, currency: 'USD' }] },
    messengerConnection: { findUnique: async () => null },
    setting: { findFirst: async () => null },
  };
  const settings = { getBookingRules: async () => ({ businessHours: [], minLeadHours: 0, maxAdvanceDays: 0 }), getAiNotes: async () => ({ text: '' }) };
  const db = { aiInstruction: { findMany: async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId), updateMany: async () => ({ count: 1 }) } };
  const instructions = new AiInstructionsService(db as never, { log: async () => undefined } as never);
  const svc = new VoiceService(prisma as never, {} as never, settings as never, {} as never, undefined, undefined, undefined, instructions);
  return svc as unknown as { runAgent: (...a: unknown[]) => Promise<{ reply: string }> };
}

const sunday = { id: 's', tenantId: 't1', kind: 'answer', text: 'On Sunday we are open 10 AM to 6 PM.', triggers: ['what time do you close on Sunday'], mode: 'verbatim', channels: ['voice'], on: true, createdAt: new Date(1) };

describe('the owner has the last word on the phone', () => {
  let fetchSpy: jest.SpyInstance;
  const said = (text: string) => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) }) as Response;
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; fetchSpy = jest.spyOn(globalThis, 'fetch' as never); });
  afterEach(() => { fetchSpy.mockRestore(); delete process.env.ANTHROPIC_API_KEY; });

  it('a wrong closing time is never spoken: the owner\'s words are', async () => {
    fetchSpy.mockResolvedValue(said('On Sunday we are open until 8 PM.') as never);
    const r = await makeSvc([sunday]).runAgent('t1', '+17145550000', '', [], 'what time do you close on Sunday?', 'en-US');
    expect(r.reply).toBe('On Sunday we are open 10 AM to 6 PM.');
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { system: { text: string }[] };
    expect(body.system[0].text).toContain('HIGHEST PRIORITY');
    expect(body.system[1].text).toContain('MUST contain exactly');
  });

  it('a right answer goes through untouched; another salon\'s instruction never applies', async () => {
    fetchSpy.mockResolvedValue(said('On Sunday we are open 10 AM to 6 PM. Want to book?') as never);
    expect((await makeSvc([sunday]).runAgent('t1', '+17145550000', '', [], 'what time do you close on Sunday?', 'en-US')).reply).toBe('On Sunday we are open 10 AM to 6 PM. Want to book?');
    fetchSpy.mockResolvedValue(said('Sunday we close at 8.') as never);
    expect((await makeSvc([sunday]).runAgent('t2', '+17145550000', '', [], 'what time do you close on Sunday?', 'en-US')).reply).toBe('Sunday we close at 8.');
  });
});
