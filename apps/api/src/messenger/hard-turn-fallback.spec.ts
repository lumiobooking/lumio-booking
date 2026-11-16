/**
 * The stronger model is optional. When the call that uses it fails, the same
 * turn is answered on the everyday model — the customer never gets the
 * "system is slow" line because of an optional switch (Lumio Agency, 16/11/2026).
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';

const mocked = chat as unknown as jest.Mock;
const ok = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });
const bad = { ok: false, status: 404, body: '{"type":"error","error":{"type":"not_found_error","message":"model: nope"}}', kind: 'other', provider: 'anthropic', fellBack: false };

function build() {
  const prisma = {
    tenant: { findUnique: async () => ({ name: 'Zb Nails', timezone: 'America/Chicago', contactPhone: null, contactEmail: null, businessType: 'SALON', market: 'US' }) },
    setting: { findFirst: async () => null },
  };
  const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never);
  (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
  return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
}
// A complaint is a "hard" turn (common/hard-turn).
const COMPLAINT = 'I am really upset, my nails fell apart after two days and I want a refund';

describe('a failing hard model never costs the customer an answer', () => {
  const env = { ...process.env };
  beforeEach(() => { mocked.mockReset(); process.env.ANTHROPIC_API_KEY = 'test-placeholder'; process.env.ANTHROPIC_HARD_MODEL = 'nope-model'; });
  afterAll(() => { process.env = env; });

  it('the hard call fails → the same turn is answered on the default model', async () => {
    mocked.mockResolvedValueOnce(bad).mockResolvedValue(ok('I am so sorry about that. Could you tell me which day you came in?'));
    const out = await build().runAgent('t1', '', [{ role: 'user', content: COMPLAINT }], COMPLAINT, { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toContain('so sorry');
    expect(mocked.mock.calls[0][0].model).toBe('nope-model');
    expect(mocked.mock.calls[1][0].model).toBeUndefined();
  });

  it('with no hard model set, a hard failure still fails loudly (nothing is hidden)', async () => {
    delete process.env.ANTHROPIC_HARD_MODEL;
    mocked.mockResolvedValue(bad);
    await expect(build().runAgent('t1', '', [{ role: 'user', content: COMPLAINT }], COMPLAINT, { mode: 'booking', leadEmail: null, channel: 'messenger' })).rejects.toThrow(/anthropic 404/);
  });
});
