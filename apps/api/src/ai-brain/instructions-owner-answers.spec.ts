/**
 * The owner's own exact answers are never held up by the owner's general
 * rules, several questions at once each get their answer, and "do not reply"
 * means nothing is sent. Every case is a real one from Amy's Lash and Brows
 * (16/11/2026), where the salon's rules blocked 1,153 of 3,795 replies.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client') }));
jest.mock('../common/llm', () => ({ chat: jest.fn() }));
import { chat } from '../common/llm';
import { AiInstructionsService } from './instructions.service';
import { judgePrompt, lastResort, matchedBlock, matchInstructions, mostlyApproved, parseJudge, type Instruction } from './instructions';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mocked = chat as unknown as jest.Mock;
const judge = (o: Row) => ({ ok: true, reply: { content: [{ type: 'text', text: JSON.stringify(o) }], usage: {} } });

const ins = (o: Partial<Instruction> & { id: string; kind: Instruction['kind']; text: string }): Instruction =>
  ({ tenantId: 'amy', triggers: [], mode: 'meaning', channels: [], on: true, usedCount: 0, blockedCount: 0, createdAt: new Date(1), ...o } as unknown as Instruction);

const LAST = "I understand how it feels to draw your brows on every day. Some days they come out uneven. With us, it takes only about 2 hours — and your brows will last 1 to 5 years, depending on your skin and your lifestyle. Are you ready to book a free consultation? Which day works for you? 😊";
const WHERE = "We have two locations: 1205 Elizabeth St Ste C, Punta Gorda, FL 33950 and 734 Shamrock Blvd, Venice, FL 34293. We're open Monday to Saturday, 10 AM to 6 PM, and closed Sundays. 😊";
const SMP = 'Scalp Micropigmentation is a permanent cosmetic treatment, though it typically fades gradually over about 1–5 years depending on your skin and lifestyle. 😊';
const rules: Instruction[] = [
  ins({ id: 'short', kind: 'always', text: 'Keep replies short (under 60 words) with at most ONE follow-up question. Do not greet again.' }),
  ins({ id: 'nobook', kind: 'always', text: 'When a customer asks to book an appointment or FREE consultation, do NOT reply at all. Stay completely silent and wait for the owner.' }),
  ins({ id: 'last', kind: 'answer', mode: 'verbatim', triggers: ['how long do they last', "I don't want to draw them on every morning"], text: LAST }),
  ins({ id: 'where', kind: 'answer', mode: 'verbatim', triggers: ['Where are you located?', 'Where is your location?'], text: WHERE }),
  ins({ id: 'smp', kind: 'answer', mode: 'verbatim', triggers: ['Is Scalp Micropigmentation permanent?'], text: SMP }),
];
const other: Instruction[] = [ins({ id: 'x', tenantId: 'other', kind: 'never', text: 'Mention parking' } as never)];

function build() {
  const db = { aiInstruction: { findMany: async ({ where }: Row) => [...rules, ...other].filter((r) => (r as unknown as Row).tenantId === where.tenantId), updateMany: async () => ({ count: 1 }) } };
  return new AiInstructionsService(db as never, { log: async () => undefined } as never);
}

describe('the owner\'s exact answers and the owner\'s general rules', () => {
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => mocked.mockReset());

  it('the owner\'s own answer goes out without a judge — a length or "no booking invitation" rule cannot block it', async () => {
    const svc = build();
    const turn = await svc.forTurn('amy', 'messenger', "I'm tired of draw them on every morning. How long do they last");
    expect(turn.matches.map((m) => m.ins.id)).toContain('last');
    const out = await svc.check('amy', { turn, channel: 'messenger', customer: 'How long do they last', draft: `Hi Mercy! ${LAST}`, lang: 'en' });
    expect(out.broken).toEqual([]);
    expect(mocked).not.toHaveBeenCalled();
  });

  it('a draft that adds a lot of its own is still judged — and the judge is told which text is pre-approved', async () => {
    const svc = build();
    const turn = await svc.forTurn('amy', 'messenger', 'How long do they last');
    mocked.mockResolvedValueOnce(judge({ applies: [], violations: [], rewrite: '' }));
    const extra = ' Lash extensions usually last two to three weeks and Sarasota is only a thirty minute drive from our studio, so many clients come from there every single week for a visit.';
    await svc.check('amy', { turn, channel: 'messenger', customer: 'How long do they last', draft: LAST + extra, lang: 'en' });
    expect(mocked).toHaveBeenCalledTimes(1);
    const user = mocked.mock.calls[0][0].messages[0].content as string;
    expect(user).toContain('PRE-APPROVED BY THE OWNER');
    expect(user).toContain('NEVER add a fact, a price, a duration, a distance');
  });

  it('"do not reply at all" is obeyed by sending nothing', async () => {
    const svc = build();
    const turn = await svc.forTurn('amy', 'messenger', 'Can I book a FREE consultation?');
    mocked.mockResolvedValueOnce(judge({ applies: ['R2'], violations: ['R2'], rewrite: '', silent: true }));
    const out = await svc.check('amy', { turn, channel: 'messenger', customer: 'Can I book a FREE consultation?', draft: 'Sure! Which day works for you?', lang: 'en' });
    expect(out.silent).toBe(true);
    expect(out.broken).toEqual([]);
    expect(parseJudge('{"applies":[],"violations":[],"rewrite":""}', [])?.silent).toBe(false);
  });

  it('several questions tapped at once: each owner answer is pinned, and each is sent if the model fails twice', () => {
    const msg = 'Is Scalp Micropigmentation permanent?\nWhere your location?\nHow long do they last';
    const m = matchInstructions(rules, msg, 'messenger');
    expect(m.map((x) => x.ins.id).sort()).toEqual(['last', 'smp', 'where']);
    const pinned = matchedBlock(rules, m);
    expect(pinned).toContain('PRE-APPROVED');
    expect(pinned).toContain('one after another in the order the customer asked');
    expect(pinned).toContain('never drop a question');
    const sent = lastResort([rules[4], rules[3]], '', true);
    expect(sent).toContain(SMP);
    expect(sent).toContain(WHERE);
  });

  it('mostlyApproved: a greeting around the owner\'s words is fine, a second paragraph of its own is not', () => {
    expect(mostlyApproved(`Hi Deb! ${WHERE}`, [WHERE])).toBe(true);
    expect(mostlyApproved(WHERE + ' We also offer free parking, complimentary champagne, a loyalty discount of twenty percent and same day appointments every single morning.', [WHERE])).toBe(false);
    expect(mostlyApproved('Anything', [])).toBe(false);
  });

  it('only this salon\'s instructions are read', async () => {
    const turn = await build().forTurn('amy', 'messenger', 'where are you located?');
    expect(turn.all.some((i) => i.id === 'x')).toBe(false);
    expect(judgePrompt({ all: turn.all, check: turn.all, customer: 'hi', draft: 'hello', langName: 'English', voice: false }).user).not.toContain('Mention parking');
  });
});
