/**
 * Why the AI did not answer (18/11/2026): the reason kept on the
 * conversation — which reason, how long it stays true, and that it is only
 * ever written to and read from the salon's own thread.
 */
import { AI_NOTE_AUTHOR, aiWhyCurrent, aiWhyFor, aiWhyNote, isAiWhyNote, readAiWhy } from './ai-why';
import { MessengerService } from './messenger.service';

type Row = Record<string, unknown>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (tenantId: string) => ({ userId: 'u1', tenantId, role: 'SALON_ADMIN' }) as never;

describe('which reason', () => {
  it('silence the owner asked for is told apart from silence the AI chose', () => {
    expect(aiWhyFor({ outcome: 'silent', guards: ['instruction'] })).toBe('silent_rule');
    expect(aiWhyFor({ outcome: 'silent', guards: [] })).toBe('silent_choice');
    expect(aiWhyFor({ outcome: 'silent' })).toBe('silent_choice');
  });
  it('a held reply: against the instructions, or not safe to send', () => {
    expect(aiWhyFor({ outcome: 'held', guards: ['instruction'], doorWhy: 'no compliant reply' })).toBe('held_rule');
    expect(aiWhyFor({ outcome: 'held', guards: [], doorWhy: 'forbidden phrase "yelp"' })).toBe('held_rule');
    expect(aiWhyFor({ outcome: 'held', guards: ['price-watch'], doorWhy: 'internal text (label)' })).toBe('held_safety');
    expect(aiWhyFor({ outcome: 'failed', guards: ['instruction'] })).toBe('failed');
  });
});

describe('the stored note', () => {
  it('round-trips, and nothing a person wrote is read as one', () => {
    const n = { text: aiWhyNote('silent_rule'), authorName: AI_NOTE_AUTHOR };
    expect(readAiWhy(n)).toBe('silent_rule');
    expect(isAiWhyNote(n)).toBe(true);
    expect(readAiWhy({ text: aiWhyNote('silent_rule'), authorName: 'Lan' })).toBeNull();
    expect(isAiWhyNote({ text: 'Khách quen, thích thợ Mai', authorName: 'Lan' })).toBe(false);
    expect(readAiWhy({ text: '[[AI_WHY drop_tables]]', authorName: AI_NOTE_AUTHOR })).toBeNull();
    expect(readAiWhy(null)).toBeNull();
  });
  it('is true only while the customer\'s last message is the one it was written for', () => {
    const asked = new Date('2026-11-18T03:00:00Z');
    expect(aiWhyCurrent(new Date('2026-11-18T03:00:09Z'), asked, true)).toBe(true);
    expect(aiWhyCurrent(new Date('2026-11-18T02:40:00Z'), asked, true)).toBe(false); // the customer wrote again since
    expect(aiWhyCurrent(new Date('2026-11-18T03:00:09Z'), asked, false)).toBe(false); // somebody answered
    expect(aiWhyCurrent(null, asked, true)).toBe(false);
    expect(aiWhyCurrent('not a date', asked, true)).toBe(false);
  });
});

function build() {
  const threads: Row[] = [{ id: 't-a', tenantId: A }, { id: 't-b', tenantId: B }];
  const notes: Row[] = [
    { id: 'n1', tenantId: A, threadId: 't-a', authorName: 'Lan', text: 'Khách quen', createdAt: new Date(1) },
    { id: 'n2', tenantId: A, threadId: 't-a', authorName: AI_NOTE_AUTHOR, text: aiWhyNote('failed'), createdAt: new Date(2) },
    { id: 'n3', tenantId: B, threadId: 't-b', authorName: AI_NOTE_AUTHOR, text: aiWhyNote('held_rule'), createdAt: new Date(3) },
  ];
  const hit = (n: Row, w: Row) => n.tenantId === w.tenantId && n.threadId === w.threadId
    && (w.authorName === undefined || n.authorName === w.authorName)
    && (w.text === undefined || String(n.text).startsWith((w.text as { startsWith: string }).startsWith));
  const prisma = {
    messengerThread: { findFirst: async (q: { where: Row }) => threads.find((t) => t.id === q.where.id && t.tenantId === q.where.tenantId) ?? null },
    messengerNote: {
      deleteMany: async (q: { where: Row }) => { const gone = notes.filter((n) => hit(n, q.where)); gone.forEach((n) => notes.splice(notes.indexOf(n), 1)); return { count: gone.length }; },
      create: async (q: { data: Row }) => { notes.push({ id: `n${notes.length + 10}`, createdAt: new Date(), ...q.data }); return {}; },
      findMany: async (q: { where: Row }) => notes.filter((n) => hit(n, q.where)),
    },
  };
  const s = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const noteWhy = (tenantId: string, threadId: string, code: string) => { (s as unknown as { noteWhy: (a: string, b: string, c: string) => void }).noteWhy(tenantId, threadId, code); return new Promise((r) => setTimeout(r, 5)); };
  return { s, notes, noteWhy };
}

describe('kept on the salon\'s own conversation', () => {
  it('the newest reason replaces the last; the staff\'s notes are untouched', async () => {
    const { notes, noteWhy } = build();
    await noteWhy(A, 't-a', 'silent_rule');
    const mine = notes.filter((n) => n.tenantId === A);
    expect(mine.map((n) => n.text)).toEqual(['Khách quen', aiWhyNote('silent_rule')]);
    expect(mine[1]).toMatchObject({ authorId: null, authorName: AI_NOTE_AUTHOR, threadId: 't-a' });
  });

  it('CROSS-TENANT: one salon cannot write to, replace or remove another salon\'s reason', async () => {
    const { notes, noteWhy } = build();
    await noteWhy(A, 't-b', 'failed'); // salon A naming salon B's thread
    expect(notes.filter((n) => n.threadId === 't-b')).toEqual([expect.objectContaining({ id: 'n3', tenantId: B, text: aiWhyNote('held_rule') })]);
    expect(notes.filter((n) => n.tenantId === A).map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('the notes list a person sees never shows the stored code — and never another salon\'s', async () => {
    const { s } = build();
    expect((await s.listNotes(user(A), 't-a') as Row[]).map((n) => n.text)).toEqual(['Khách quen']);
    expect(await s.listNotes(user(A), 't-b')).toEqual([]);
    expect(await s.listNotes(user(B), 't-b')).toEqual([]);
  });
});
