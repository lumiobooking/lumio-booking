/**
 * "Sơ diện thoai của nhan so mấy?" — a customer asking for OUR phone number,
 * typed fast with no accents — was answered with the pricing line ("giá phụ
 * thuộc vào tình hình của từng tiệm"). Both bots now carry a rule to read a
 * message by sound and context, to treat a phone-number question as a
 * phone-number question (never a price), and to ask one clarifying question
 * instead of guessing. This pins that rule into the system prompt.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';

const mocked = chat as unknown as jest.Mock;
const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });

function svc() {
  const prisma = {
    tenant: { findUnique: async () => ({ name: 'Lumio', timezone: 'Asia/Ho_Chi_Minh', contactPhone: '0901 234 567', contactEmail: null, businessType: 'agency', market: 'VN' }) },
    setting: { findFirst: async () => null },
  };
  const settings = { getAiNotes: async () => ({ text: '' }) };
  const s = new MessengerService(prisma as never, {} as never, settings as never, {} as never, {} as never, {} as never);
  (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => 'Salon phone: 0901 234 567';
  return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
}
const systemOf = (call: unknown) => ((call as { system: { text: string }[] }).system).map((b) => b.text).join('\n');

describe('read what they meant, not what they typed', () => {
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => mocked.mockReset());

  it.each(['sales', 'booking'] as const)('the %s bot is told to sound out typos, to answer a phone-number question with the number, and to ask when unsure', async (mode) => {
    mocked.mockResolvedValueOnce(reply('Dạ số của bên em là 0901 234 567 ạ.'));
    await svc().runAgent('t1', '', [{ role: 'user', content: 'Sơ diện thoai của nhan so mấy?' }], 'Sơ diện thoai của nhan so mấy?', { mode, leadEmail: null, channel: 'messenger' });
    const system = systemOf(mocked.mock.calls[0][0]);
    expect(system).toContain('READ WHAT THEY MEANT, NOT WHAT THEY TYPED');
    expect(system).toContain('"Sơ diện thoai" = "số điện thoại"');
    expect(system).toContain('NEVER a price question');
    expect(system).toContain('ONE short clarifying question');
    // The booking bot reads the salon's contact phone from its facts; the sales
    // page's numbers live in its own channel FACTS (aiInstruction / botFacts).
    if (mode === 'booking') expect(system).toContain('Salon phone: 0901 234 567');
  });
});
