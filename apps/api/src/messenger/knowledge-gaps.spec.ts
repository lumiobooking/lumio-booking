/**
 * "Bot tự học hỏi thêm" — phase 1: what the bot did not know is kept, per
 * salon, for the owner to answer ONCE; the answer becomes a bot fact.
 * Nothing becomes a fact without the owner, and nothing crosses salons.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { factLabel, gapKey, isUnknownReply, redact } from './knowledge-gaps';
import { KnowledgeGapsService, MAX_OPEN_GAPS } from './knowledge-gaps.service';
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;
const owner = (tenantId: string) => ({ userId: `u-${tenantId}`, tenantId, role: 'SALON_ADMIN' }) as never;

describe('the rules', () => {
  it('keeps the question, not who asked it', () => {
    expect(redact('Delois Jones 334-390-4874 when is your grand opening')).toBe('Delois Jones … when is your grand opening');
    expect(redact('email me at kim@example.com do you do lashes?')).toBe('email me at … do you do lashes?');
  });

  it('counts the same question asked again instead of listing it twice', () => {
    expect(gapKey('When is your GRAND OPENING?')).toBe(gapKey('when is your grand opening'));
    expect(gapKey('Delois 334-390-4874 when is your grand opening')).toBe(gapKey('Delois 512 555 0147 when is your grand opening'));
    expect(gapKey('do you do lash lifts?')).not.toBe(gapKey('do you do brow lamination?'));
  });

  it.each([
    "I'm not sure about that — let me check with the salon and get back to you!",
    'Let me check with the team and someone will get back to you shortly.',
    'Dạ để em hỏi lại tiệm rồi báo anh/chị nhé.',
    'Dạ em chưa có thông tin này, nhân viên sẽ liên hệ lại ạ.',
  ])('hears "I do not know" in: %s', (r) => expect(isUnknownReply(r)).toBe(true));

  it.each([
    'Our grand opening is Friday, October 9 🎉 What time works for you?',
    'Gel manicure is $44 💅 What day would you like to come in?',
  ])('a real answer is not a gap: %s', (r) => expect(isUnknownReply(r)).toBe(false));

  it('a short label for the saved answer', () => {
    expect(factLabel('when is your grand opening')).toBe('when is your grand opening');
    expect(factLabel('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

/** An in-memory stand-in for the two tables involved, shared by every salon. */
function makeDb() {
  const gaps: Row[] = [];
  const conns: Record<string, Row> = { t1: { tenantId: 't1', botFacts: [{ label: 'Parking', value: 'Behind the building', on: true }] }, t2: { tenantId: 't2', botFacts: [] } };
  const audits: Row[] = [];
  const match = (g: Row, w: Row) => Object.entries(w).every(([k, v]) => g[k] === v);
  const prisma = {
    botKnowledgeGap: {
      findUnique: async (a: Row) => gaps.find((g) => g.tenantId === a.where.tenantId_key.tenantId && g.key === a.where.tenantId_key.key) ?? null,
      findFirst: async (a: Row) => gaps.find((g) => match(g, a.where)) ?? null,
      findMany: async (a: Row) => gaps.filter((g) => match(g, a.where)),
      count: async (a: Row) => gaps.filter((g) => match(g, a.where)).length,
      create: async (a: Row) => { const g = { id: `g${gaps.length + 1}`, count: 1, status: 'open', firstAt: new Date(), lastAt: new Date(), answer: null, answeredAt: null, ...a.data }; gaps.push(g); return g; },
      update: async (a: Row) => {
        const g = gaps.find((x) => x.id === a.where.id)!;
        for (const [k, v] of Object.entries(a.data)) g[k] = (v as Row)?.increment ? g[k] + (v as Row).increment : v;
        return g;
      },
    },
    messengerConnection: {
      findUnique: async (a: Row) => conns[a.where.tenantId] ?? null,
      update: async (a: Row) => { conns[a.where.tenantId].botFacts = a.data.botFacts; return conns[a.where.tenantId]; },
    },
    auditLog: { create: async (a: Row) => { audits.push(a.data); return {}; } },
  };
  return { prisma, gaps, conns, audits, svc: new KnowledgeGapsService(prisma as never) };
}

describe('the owner answers once, the bot knows from then on', () => {
  it('a repeated question is one row with a count', async () => {
    const { svc, gaps } = makeDb();
    await svc.record({ tenantId: 't1', question: 'when is your grand opening?', source: 'bot', threadId: 'th1' });
    await svc.record({ tenantId: 't1', question: 'When is your grand opening', source: 'bot', threadId: 'th2' });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ count: 2, threadId: 'th2', source: 'bot' });
  });

  it('a staff member’s answer is offered as the suggested answer', async () => {
    const { svc, gaps } = makeDb();
    await svc.record({ tenantId: 't1', question: 'when is your grand opening', source: 'bot' });
    await svc.record({ tenantId: 't1', question: 'when is your grand opening', source: 'staff', suggestedAnswer: 'Friday Oct 9!' });
    expect(gaps[0]).toMatchObject({ source: 'staff', suggestedAnswer: 'Friday Oct 9!', count: 2 });
  });

  it('answering writes a bot fact for THIS salon and marks the question answered (audited)', async () => {
    const { svc, gaps, conns, audits } = makeDb();
    await svc.record({ tenantId: 't1', question: 'when is your grand opening', source: 'bot' });
    const r = await svc.answer(owner('t1'), gaps[0].id, 'Our grand opening is Friday, October 9.');
    expect(r.label).toBe('when is your grand opening');
    expect(conns.t1.botFacts).toEqual([
      { label: 'Parking', value: 'Behind the building', on: true },
      { label: 'when is your grand opening', value: 'Our grand opening is Friday, October 9.', on: true },
    ]);
    expect(gaps[0]).toMatchObject({ status: 'answered', answer: 'Our grand opening is Friday, October 9.', answeredBy: 'u-t1' });
    expect(audits[0]).toMatchObject({ tenantId: 't1', action: 'messenger.knowledge_gap_answered' });
    expect(conns.t2.botFacts).toEqual([]);
  });

  it('answering the same question again updates the fact rather than adding a second one', async () => {
    const { svc, gaps, conns } = makeDb();
    await svc.record({ tenantId: 't1', question: 'do you do lash lifts?', source: 'bot' });
    const { label } = await svc.answer(owner('t1'), gaps[0].id, 'Not yet.');
    gaps[0].status = 'open';
    await svc.answer(owner('t1'), gaps[0].id, 'Yes — $65.');
    expect(conns.t1.botFacts.filter((f: Row) => f.label === label).map((f: Row) => f.value)).toEqual(['Yes — $65.']);
    expect(conns.t1.botFacts).toHaveLength(2);
  });

  it('an empty answer is refused; dismiss hides the question', async () => {
    const { svc, gaps } = makeDb();
    await svc.record({ tenantId: 't1', question: 'is there parking for trucks?', source: 'bot' });
    await expect(svc.answer(owner('t1'), gaps[0].id, '  ')).rejects.toThrow(/Type the answer/);
    await svc.dismiss(owner('t1'), gaps[0].id);
    expect(gaps[0].status).toBe('dismissed');
    expect((await svc.list(owner('t1'))).open).toHaveLength(0);
  });

  it('stops collecting past the cap of open questions', async () => {
    const { svc, gaps } = makeDb();
    for (let i = 0; i < MAX_OPEN_GAPS; i++) gaps.push({ id: `x${i}`, tenantId: 't1', key: `k${i}`, status: 'open', count: 1 });
    await svc.record({ tenantId: 't1', question: 'one more question please', source: 'bot' });
    expect(gaps).toHaveLength(MAX_OPEN_GAPS);
  });
});

describe('tenant isolation', () => {
  it('a salon never sees another salon’s questions', async () => {
    const { svc } = makeDb();
    await svc.record({ tenantId: 't1', question: 'when is your grand opening', source: 'bot' });
    await svc.record({ tenantId: 't2', question: 'do you sell gift cards', source: 'bot' });
    expect((await svc.list(owner('t1'))).open.map((g) => g.question)).toEqual(['when is your grand opening']);
    expect((await svc.list(owner('t2'))).open.map((g) => g.question)).toEqual(['do you sell gift cards']);
  });

  it('a salon cannot answer or dismiss another salon’s question — and no fact lands anywhere', async () => {
    const { svc, gaps, conns } = makeDb();
    await svc.record({ tenantId: 't1', question: 'when is your grand opening', source: 'bot' });
    await expect(svc.answer(owner('t2'), gaps[0].id, 'Hacked: free nails')).rejects.toThrow(/not found/);
    await expect(svc.dismiss(owner('t2'), gaps[0].id)).rejects.toThrow(/not found/);
    expect(gaps[0].status).toBe('open');
    expect(conns.t1.botFacts).toHaveLength(1);
    expect(conns.t2.botFacts).toHaveLength(0);
  });

  it('the same wording in two salons is two separate questions', async () => {
    const { svc, gaps } = makeDb();
    await svc.record({ tenantId: 't1', question: 'do you take walk-ins?', source: 'bot' });
    await svc.record({ tenantId: 't2', question: 'do you take walk-ins?', source: 'bot' });
    expect(gaps.map((g) => [g.tenantId, g.count])).toEqual([['t1', 1], ['t2', 1]]);
  });
});

describe('where questions come from', () => {
  it('a person answering the customer’s question by hand is offered as the answer', () => {
    const record = jest.fn(async () => undefined);
    const svc = new MessengerService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, { record } as never);
    const note = (svc as unknown as { noteStaffAnswer: (t: string, th: Row, a: string) => void }).noteStaffAnswer.bind(svc);
    note('t1', { id: 'th1', history: [{ role: 'user', content: 'when is your grand opening?' }] }, 'Friday Oct 9!');
    expect(record).toHaveBeenCalledWith({ tenantId: 't1', threadId: 'th1', question: 'when is your grand opening?', source: 'staff', suggestedAnswer: 'Friday Oct 9!' });
    // Not a question, or the person is not answering the customer's latest message → nothing.
    note('t1', { id: 'th1', history: [{ role: 'user', content: 'ok thanks' }] }, 'You are welcome!');
    note('t1', { id: 'th1', history: [{ role: 'user', content: 'how much?' }, { role: 'assistant', content: '$44' }] }, 'Also we have a promo');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('the bot saying "let me check with the salon" after a question records it — the reply still goes out', async () => {
    const record = jest.fn(async () => undefined);
    const thread: Row = { id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'u1', channel: 'messenger', handoff: false, lastCustomerAt: new Date(), history: [{ role: 'user', content: 'do you do lash lifts?', at: new Date().toISOString(), rid: 'r1' }] };
    const prisma = {
      messengerThread: { findUnique: async () => thread, update: async () => thread },
      salesLead: { findFirst: async () => null },
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago', market: 'US' }) },
    };
    const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, { publish: () => undefined } as never, {} as never, undefined, undefined, undefined, { record } as never);
    const s = svc as unknown as Record<string, unknown>;
    const sent: string[] = [];
    s.knownCustomerFor = async () => null;
    s.runAgent = async () => "I'm not sure about lash lifts — let me check with the salon and get back to you!";
    s.sendText = async (_t: string, _to: string, text: string) => { sent.push(text); return { ok: true }; };
    s.appendTurns = async () => undefined;
    s.countBotReply = () => undefined;
    await (s.replyAndRecord as (...a: unknown[]) => Promise<void>).call(svc, { tenantId: 't1', pageToken: 'TOK', aiInstruction: null, botFacts: [] }, 'th1', 'u1', 'do you do lash lifts?', Date.now(), {}, ['r1']);
    expect(sent).toHaveLength(1);
    expect(record).toHaveBeenCalledWith({ tenantId: 't1', threadId: 'th1', question: 'do you do lash lifts?', source: 'bot' });
  });
});
