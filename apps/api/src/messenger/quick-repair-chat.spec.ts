/**
 * QUICK REPAIR in the chat run (./quick-repair): where it has been released,
 * a draft that breaks an owner's instruction is replaced by its checker's own
 * smallest edit — no second writing, no second check — but only when that
 * edit is usable, passes the fixed gates and is addressed to the customer.
 * Every other salon keeps the old way exactly.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';
import { AiInstructionsService } from '../ai-brain/instructions.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mocked = chat as unknown as jest.Mock;
const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });
const judge = (o: Row) => reply(JSON.stringify(o));
const CLEAN = reply('CLEAN'); const LEAK = reply('LEAK');
const pass = judge({ applies: [], violations: [], rewrite: '' });

const rows: Row[] = [
  { id: 'n1', tenantId: 'test-salon', kind: 'never', text: 'Invite the customer to book when they only asked a question', triggers: [], mode: 'meaning', channels: [], on: true, createdAt: new Date(1) },
  { id: 'n2', tenantId: 'paying-salon', kind: 'never', text: 'Invite the customer to book when they only asked a question', triggers: [], mode: 'meaning', channels: [], on: true, createdAt: new Date(2) },
];

function build(released: (tenantId: string) => boolean) {
  const db = { aiInstruction: { findMany: async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId), updateMany: async () => ({ count: 1 }) } };
  const instructions = new AiInstructionsService(db as never, { log: async () => undefined } as never);
  const prisma = {
    tenant: { findUnique: async () => ({ name: 'An Sen', timezone: 'America/Los_Angeles', contactPhone: null, contactEmail: null, businessType: 'SPA', market: 'US' }) },
    setting: { findFirst: async () => null },
  };
  const release = { isOn: (f: string, tenantId: string) => f === 'quickRepair' && released(tenantId) };
  const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, instructions, release as never);
  (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
  return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
}
const Q = 'What time do you open on Sunday?';
const DRAFT = 'We open at 10:00 AM on Sunday. Would you like me to book you a time?';
const FIXED = 'We open at 10:00 AM on Sunday.';
const run = (svc: { runAgent: (...a: unknown[]) => Promise<string> }, tenantId: string, ctx: Row = {}) =>
  svc.runAgent(tenantId, '', [{ role: 'user', content: Q }], Q, Object.assign(ctx, { mode: 'booking', leadEmail: null, channel: 'messenger' }));
const onlyTest = (id: string) => id === 'test-salon';

describe('quick repair of a draft the owner\'s instructions block', () => {
  const env = { ...process.env };
  beforeEach(() => { mocked.mockReset(); process.env.ANTHROPIC_API_KEY = 'test-placeholder'; delete process.env.ANTHROPIC_HARD_MODEL; delete process.env.QUICK_REPAIR; });
  afterAll(() => { process.env = env; });

  it('released: the checker\'s own edit goes out — three model calls, not five', async () => {
    mocked.mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: FIXED })).mockResolvedValueOnce(CLEAN);
    const ctx: Row = {};
    const out = await run(build(onlyTest), 'test-salon', ctx);
    expect(out).toBe(FIXED);
    expect(mocked).toHaveBeenCalledTimes(3); // the draft, the check, the second reader
    expect(JSON.stringify(mocked.mock.calls.map((c) => c[0].messages))).not.toContain('SYSTEM CORRECTION'); // nothing was sent back to be written again
    expect(ctx.traceGuards).toContain('instruction');
  });

  it('NOT released (every other salon): written again and checked again, exactly as before', async () => {
    mocked
      .mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: FIXED }))
      .mockResolvedValueOnce(reply('We open at 10:00 AM on Sunday 😊')).mockResolvedValueOnce(pass).mockResolvedValueOnce(CLEAN);
    const out = await run(build(onlyTest), 'paying-salon');
    expect(out).toBe('We open at 10:00 AM on Sunday 😊');
    expect(JSON.stringify(mocked.mock.calls[2][0].messages)).toContain('SYSTEM CORRECTION');
  });

  it('released, but the checker gave no usable edit (it added instead of removing): the old way', async () => {
    const grown = `${DRAFT} We also have a 20% promotion this week, free parking behind the building, a loyalty card and gift vouchers for every new guest who visits us before the end of the month.`;
    mocked
      .mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: grown }))
      .mockResolvedValueOnce(reply(FIXED)).mockResolvedValueOnce(pass).mockResolvedValueOnce(CLEAN);
    const out = await run(build(onlyTest), 'test-salon');
    expect(out).toBe(FIXED);
    expect(JSON.stringify(mocked.mock.calls[2][0].messages)).toContain('SYSTEM CORRECTION');
  });

  it('released, but the edit fails a fixed gate ("you are booked" with no booking): never sent, the old way', async () => {
    mocked
      .mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: 'We open at 10:00 AM on Sunday — you are booked in for 10!' }))
      .mockResolvedValueOnce(reply(FIXED)).mockResolvedValueOnce(pass).mockResolvedValueOnce(CLEAN);
    const out = await run(build(onlyTest), 'test-salon');
    expect(out).toBe(FIXED);
    expect(out).not.toContain('booked in');
  });

  it('released, but the edit talks about the correction instead of to the customer: never sent', async () => {
    mocked
      .mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: 'As corrected: on Sunday the doors open at 10:00 AM.' }))
      .mockResolvedValueOnce(LEAK) // the second reader refuses the edit
      .mockResolvedValueOnce(reply(FIXED)).mockResolvedValueOnce(pass).mockResolvedValueOnce(CLEAN);
    const out = await run(build(onlyTest), 'test-salon');
    expect(out).toBe(FIXED);
    expect(JSON.stringify(mocked.mock.calls[3][0].messages)).toContain('SYSTEM CORRECTION');
  });

  it('QUICK_REPAIR=off on the server switches it off everywhere, at once', async () => {
    process.env.QUICK_REPAIR = 'off';
    mocked
      .mockResolvedValueOnce(reply(DRAFT)).mockResolvedValueOnce(judge({ applies: ['N1'], violations: ['N1'], rewrite: FIXED }))
      .mockResolvedValueOnce(reply('We open at 10:00 AM on Sunday 😊')).mockResolvedValueOnce(pass).mockResolvedValueOnce(CLEAN);
    const out = await run(build(() => true), 'test-salon');
    expect(out).toBe('We open at 10:00 AM on Sunday 😊');
  });

  it('a draft that breaks nothing is untouched by any of this', async () => {
    mocked.mockResolvedValueOnce(reply(FIXED)).mockResolvedValueOnce(pass);
    const out = await run(build(onlyTest), 'test-salon');
    expect(out).toBe(FIXED);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});
