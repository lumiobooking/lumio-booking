/**
 * The owner's instructions are one salon's: written only by its owner or a
 * manager, read only for its own customers, and checked before a reply goes.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' },
    StaffRole: actual.StaffRole ?? { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
  };
});
jest.mock('../common/llm', () => ({ chat: jest.fn() }));
import { chat } from '../common/llm';
import { AiInstructionsService, instructionChannel } from './instructions.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, c]) => (c && typeof c === 'object' && 'in' in c ? (c.in as unknown[]).includes(row[k]) : row[k] === c));
}
function build() {
  const rows: Row[] = [
    { id: 'b1', tenantId: 'tb', kind: 'never', text: 'Talk about prices', triggers: [], mode: 'meaning', channels: [], on: true, usedCount: 0, blockedCount: 0, createdAt: new Date(1) },
  ];
  const audits: Row[] = [];
  let n = 0;
  const db = {
    aiInstruction: {
      findMany: async ({ where }: Row) => rows.filter((r) => matches(r, where)),
      findFirst: async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null,
      count: async ({ where }: Row) => rows.filter((r) => matches(r, where)).length,
      create: async ({ data }: Row) => { const r = { id: `i${++n}`, usedCount: 0, blockedCount: 0, createdAt: new Date(1000 + n), ...data }; rows.push(r); return r; },
      updateMany: async ({ where, data }: Row) => {
        let c = 0;
        for (const r of rows) if (matches(r, where)) {
          c += 1;
          for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? (r[k] ?? 0) + (v as Row).increment : v;
        }
        return { count: c };
      },
      deleteMany: async ({ where }: Row) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); return { count: before - rows.length }; },
    },
  };
  const svc = new AiInstructionsService(db as never, { log: async (a: Row) => { audits.push(a); } } as never);
  return { svc, rows, audits };
}
const owner = (t: string) => ({ userId: `o-${t}`, email: `o@${t}`, role: 'SALON_ADMIN', tenantId: t }) as never;
const manager = (t: string) => ({ userId: `m-${t}`, role: 'STAFF', staffRole: 'MANAGER', tenantId: t }) as never;
const desk = (t: string) => ({ userId: `d-${t}`, role: 'STAFF', staffRole: 'RECEPTIONIST', tenantId: t }) as never;

const sunday = { kind: 'answer', text: 'On Sunday we are open 10 AM to 6 PM.', triggers: ['what time do you close on Sunday'], mode: 'verbatim', channels: ['voice'] };

describe('who may teach the AI', () => {
  it('the owner and a manager may; the desk may only read', async () => {
    const { svc, audits } = build();
    await expect(svc.create(owner('ta'), sunday)).resolves.toMatchObject({ kind: 'answer', mode: 'verbatim', channels: ['voice'] });
    await expect(svc.create(manager('ta'), { kind: 'never', text: 'Promise discounts' })).resolves.toMatchObject({ kind: 'never' });
    await expect(svc.create(desk('ta'), { kind: 'never', text: 'x y z' })).rejects.toThrow(/owner or a manager/);
    expect((await svc.list(desk('ta'))).canEdit).toBe(false);
    expect(audits.map((a) => a.action)).toEqual(['ai_instruction.created', 'ai_instruction.created']);
    expect(audits[0]).toMatchObject({ tenantId: 'ta', userId: 'o-ta' });
  });
  it('a bad body is refused with the reason', async () => {
    const { svc } = build();
    await expect(svc.create(owner('ta'), { kind: 'answer', text: 'We close at 6' })).rejects.toThrow(/at least one question/);
  });
});

describe('one salon never sees or changes another salon\'s instructions', () => {
  it('list, edit and delete are scoped to the signed-in salon', async () => {
    const { svc, rows } = build();
    expect((await svc.list(owner('ta'))).items).toEqual([]);
    await expect(svc.update(owner('ta'), 'b1', { text: 'Hijacked' })).rejects.toThrow(/not found/);
    await expect(svc.remove(owner('ta'), 'b1')).rejects.toThrow(/not found/);
    expect(rows.find((r) => r.id === 'b1')).toMatchObject({ tenantId: 'tb', text: 'Talk about prices' });
  });
  it('the assistants of salon A get only salon A\'s rules', async () => {
    const { svc } = build();
    await svc.create(owner('ta'), sunday);
    const a = await svc.forTurn('ta', 'voice', 'what time do you close on sunday?');
    expect(a.all.map((i) => i.text)).toEqual([sunday.text]);
    expect(a.block).not.toContain('Talk about prices');
    expect(a.matched).toContain('MUST contain exactly');
    const b = await svc.forTurn('tb', 'voice', 'what time do you close on sunday?');
    expect(b.block).toContain('Talk about prices');
    expect(b.block).not.toContain('Sunday');
  });
  it('a change is seen at once (the cache is dropped)', async () => {
    const { svc } = build();
    const made = await svc.create(owner('ta'), sunday);
    expect((await svc.forTurn('ta', 'voice', 'hi')).block).toContain('Sunday');
    await svc.update(owner('ta'), made.id, { on: false });
    expect((await svc.forTurn('ta', 'voice', 'hi')).block).toBe('');
  });
});

describe('the check before a reply goes', () => {
  beforeEach(() => { (chat as jest.Mock).mockReset(); process.env.ANTHROPIC_API_KEY = 'k'; });

  it('a word-for-word answer is checked by its words, without a model call', async () => {
    const { svc } = build();
    await svc.create(owner('ta'), sunday);
    const turn = await svc.forTurn('ta', 'voice', 'what time do you close on sunday');
    const bad = await svc.check('ta', { turn, channel: 'voice', customer: 'what time do you close on sunday', draft: 'We close at 8 PM on Sunday.', lang: 'en' });
    expect(bad.broken.map((i) => i.text)).toEqual([sunday.text]);
    const good = await svc.check('ta', { turn, channel: 'voice', customer: 'what time do you close on sunday', draft: 'On Sunday we are open 10 AM to 6 PM. Want to book?', lang: 'en' });
    expect(good.broken).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
  it('a NEVER rule is judged; the verdict and rewrite come back', async () => {
    const { svc } = build();
    await svc.create(owner('ta'), { kind: 'never', text: 'Promise a discount that is not on the promo list' });
    (chat as jest.Mock).mockResolvedValue({ ok: true, reply: { content: [{ type: 'text', text: '{"applies":["N1"],"violations":["N1"],"rewrite":"We have no first-visit discount right now."}' }] } });
    const turn = await svc.forTurn('ta', 'messenger', 'first time discount?');
    const r = await svc.check('ta', { turn, channel: 'messenger', customer: 'first time discount?', draft: 'Yes! 20% off.', lang: 'en' });
    expect(r.broken).toHaveLength(1);
    expect(r.rewrite).toBe('We have no first-visit discount right now.');
  });
  it('a judge that fails or talks nonsense never blocks a reply', async () => {
    const { svc } = build();
    await svc.create(owner('ta'), { kind: 'never', text: 'Promise a discount' });
    const turn = await svc.forTurn('ta', 'messenger', 'hello');
    (chat as jest.Mock).mockResolvedValue({ ok: false, status: 529, body: 'busy', kind: 'overloaded', provider: 'anthropic', fellBack: false });
    expect((await svc.check('ta', { turn, channel: 'messenger', customer: 'hello', draft: 'Hi!', lang: 'en' })).broken).toEqual([]);
    (chat as jest.Mock).mockResolvedValue({ ok: true, reply: { content: [{ type: 'text', text: 'I think it is fine' }] } });
    expect((await svc.check('ta', { turn, channel: 'messenger', customer: 'hello', draft: 'Hi!', lang: 'en' })).broken).toEqual([]);
  });
  it('a salon without instructions costs no check at all', async () => {
    const { svc } = build();
    const turn = await svc.forTurn('ta', 'messenger', 'hello');
    expect(await svc.check('ta', { turn, channel: 'messenger', customer: 'hello', draft: 'Hi!', lang: 'en' })).toEqual({ broken: [], applied: [], rewrite: '' });
    expect(chat).not.toHaveBeenCalled();
  });
  it('use is counted on the salon\'s own rows only', async () => {
    const { svc, rows } = build();
    const made = await svc.create(owner('ta'), sunday);
    const turn = await svc.forTurn('ta', 'voice', 'x');
    svc.noteUse('ta', turn.all, []);
    svc.noteUse('ta', [{ ...turn.all[0], id: 'b1' }], []);
    await new Promise((r) => setTimeout(r, 5));
    expect(rows.find((r) => r.id === made.id)!.usedCount).toBe(1);
    expect(rows.find((r) => r.id === 'b1')!.usedCount).toBe(0);
  });
  it('channel names map safely', () => {
    expect(instructionChannel('instagram')).toBe('instagram');
    expect(instructionChannel('weird')).toBe('messenger');
  });
});
