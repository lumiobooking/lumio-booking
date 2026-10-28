/**
 * The chat bot obeys the owner's instructions (ai-brain/instructions.ts):
 * they sit above everything in the prompt, the matched one is pinned to the
 * message, and a reply that breaks one is sent back — then replaced.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';
import { AiInstructionsService } from '../ai-brain/instructions.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const mocked = chat as unknown as jest.Mock;
const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });

function build(rows: Row[]) {
  const db = {
    aiInstruction: {
      findMany: async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId),
      updateMany: async () => ({ count: 1 }),
    },
  };
  const instructions = new AiInstructionsService(db as never, { log: async () => undefined } as never);
  const prisma = {
    tenant: { findUnique: async () => ({ name: 'An Sen', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'SPA', market: 'US' }) },
    setting: { findFirst: async () => null },
  };
  const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, instructions);
  (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
  return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
}
const run = (svc: { runAgent: (...a: unknown[]) => Promise<string> }, tenantId: string, text: string) =>
  svc.runAgent(tenantId, '', [{ role: 'user', content: text }], text, { mode: 'booking', leadEmail: null, channel: 'messenger' });

const rows: Row[] = [
  { id: 'a1', tenantId: 't1', kind: 'answer', text: 'We do not have a first-visit discount right now.', triggers: ['first-time discount'], mode: 'verbatim', channels: [], on: true, createdAt: new Date(1) },
  { id: 'n1', tenantId: 't1', kind: 'never', text: 'Promise a discount that is not on the promo list', triggers: [], mode: 'meaning', channels: [], on: true, createdAt: new Date(2) },
  { id: 'x1', tenantId: 't2', kind: 'never', text: 'Mention parking', triggers: [], mode: 'meaning', channels: [], on: true, createdAt: new Date(3) },
];
const judge = (o: Row) => reply(JSON.stringify(o));
const ok = judge({ applies: [], violations: [], rewrite: '' });

describe('the owner has the last word in chat', () => {
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => mocked.mockReset());

  it('the instructions outrank the prompt, the matched answer is pinned, and only THIS salon\'s are used', async () => {
    mocked.mockResolvedValueOnce(reply('We do not have a first-visit discount right now. Want to book?')).mockResolvedValueOnce(ok);
    const out = await run(build(rows), 't1', 'Is there a first-time discount?');
    expect(out).toContain('first-visit discount');
    const system = (mocked.mock.calls[0][0].system as { text: string }[]).map((b) => b.text).join('\n');
    expect(system).toContain('THE OWNER\'S INSTRUCTIONS — HIGHEST PRIORITY');
    expect(system).toContain('[A1] Your reply MUST contain exactly');
    expect(system).not.toContain('Mention parking');
  });

  it('a reply that breaks an instruction is sent back with the instruction quoted', async () => {
    mocked
      .mockResolvedValueOnce(reply('Yes! New clients get 20% off.'))
      .mockResolvedValueOnce(judge({ applies: ['N2'], violations: ['N2'], rewrite: '' }))
      .mockResolvedValueOnce(reply('We do not have a first-visit discount right now — would you like to book?'))
      .mockResolvedValueOnce(ok);
    const out = await run(build(rows), 't1', 'Is there a first-time discount?');
    expect(out).toBe('We do not have a first-visit discount right now — would you like to book?');
    const back = JSON.stringify(mocked.mock.calls[2][0].messages.slice(-1)[0].content);
    expect(back).toContain('SYSTEM CORRECTION');
    expect(back).toContain('first-visit discount');
  });

  it('broken twice: the corrected reply goes out, never the forbidden one', async () => {
    mocked
      .mockResolvedValueOnce(reply('Yes! 20% off for new clients.'))
      .mockResolvedValueOnce(judge({ applies: ['N2'], violations: ['N2'], rewrite: '' }))
      .mockResolvedValueOnce(reply('Sure, 20% off your first visit!'))
      .mockResolvedValueOnce(judge({ applies: ['N2'], violations: ['N2'], rewrite: 'We have no first-visit discount, but I can book you in. What day works?' }));
    const out = await run(build(rows), 't1', 'any deals?');
    expect(out).toBe('We have no first-visit discount, but I can book you in. What day works?');
    expect(out).not.toMatch(/20%/);
  });

  it('a salon with no instructions runs exactly as before — no extra call', async () => {
    mocked.mockResolvedValueOnce(reply('Hi! What can I book for you?'));
    const out = await run(build(rows.filter((r) => r.tenantId !== 't1' && r.tenantId !== 't2')), 't1', 'hello');
    expect(out).toBe('Hi! What can I book for you?');
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('a SALES-mode page obeys its owner too — a correction made in the Inbox changes every later reply on it', async () => {
    const sales: Row[] = [
      { id: 's1', tenantId: 't3', kind: 'answer', text: 'Social Care covers Facebook, Instagram and TikTok — Shorts and Yelp are not included.', triggers: ['Gói Social Care bao gồm những gì'], mode: 'meaning', channels: [], on: true, createdAt: new Date(4) },
      { id: 'x2', tenantId: 't4', kind: 'never', text: 'Mention parking', triggers: [], mode: 'meaning', channels: [], on: true, createdAt: new Date(5) },
    ];
    mocked
      .mockResolvedValueOnce(reply('Dạ gói Social Care gồm Facebook, Instagram, TikTok, Shorts, Yelp ạ.'))
      .mockResolvedValueOnce(judge({ applies: ['A1'], violations: ['A1'], rewrite: '' }))
      .mockResolvedValueOnce(reply('Dạ gói Social Care gồm đăng bài trên Facebook, Instagram và TikTok ạ.'))
      .mockResolvedValueOnce(ok);
    const svc = build(sales);
    const text = 'Gói Marketing Lumio Social Care bao gồm những gì?';
    const out = await svc.runAgent('t3', '', [{ role: 'user', content: text }], text, { mode: 'sales', leadEmail: null, channel: 'messenger' });
    expect(out).not.toMatch(/Shorts|Yelp/);
    const system = (mocked.mock.calls[0][0].system as { text: string }[]).map((b) => b.text).join('\n');
    expect(system).toContain('THE OWNER\'S INSTRUCTIONS — HIGHEST PRIORITY');
    expect(system).not.toContain('Mention parking');
  });
});
