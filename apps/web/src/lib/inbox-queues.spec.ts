import { pileOf, pileLabel, queueRows, queueCounts, inboxSections, waitText, waitedMinutes, AI_MISSED_AFTER_MIN } from './inbox-queues';
import type { InboxRow } from './inbox-view';

const NOW = new Date('2026-11-17T04:00:00.000Z');
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
const row = (over: Partial<InboxRow> = {}): InboxRow => ({ id: 'r', updatedAt: ago(1), lastMessageAt: ago(1), state: 'bot', ...over });
/** The customer wrote `mins` ago and nobody has answered. */
const owed = (mins: number, over: Partial<InboxRow> = {}) => row({ customerLast: true, lastCustomerAt: ago(mins), lastMessageAt: ago(mins), lastText: 'Khi nào bên mình gọi lại cho mình vậy?', ...over });

describe('which pile a conversation is in', () => {
  it('the 17/11 case: the AI never answered a question from five hours ago — a person must', () => {
    const p = pileOf(owed(300), NOW);
    expect(p).toEqual({ pile: 'needs', why: 'ai-missed', waited: 300 });
    expect(pileLabel(owed(300), true, NOW)).toEqual({ text: 'AI chưa trả lời · 5 giờ', tone: 'bad' });
  });

  it('gives the AI its few minutes before calling it a person\'s job', () => {
    expect(pileOf(owed(AI_MISSED_AFTER_MIN - 1), NOW)).toMatchObject({ pile: 'ai', why: 'ai-working' });
    expect(pileOf(owed(AI_MISSED_AFTER_MIN), NOW)).toMatchObject({ pile: 'needs', why: 'ai-missed' });
  });

  it('a teammate holding the chat who has not answered the last message owes the answer', () => {
    const r = owed(4, { state: 'human', assignedName: 'Hoa' });
    expect(pileOf(r, NOW)).toMatchObject({ pile: 'needs', why: 'holder', waited: 4 });
    expect(pileLabel(r, true, NOW)).toEqual({ text: 'Chờ Hoa trả lời · 4 phút', tone: 'warn' });
  });

  it('a teammate who answered last is waiting on the customer — not work', () => {
    const r = row({ state: 'human', assignedName: 'Hoa', customerLast: false, lastCustomerAt: ago(30) });
    expect(pileOf(r, NOW)).toMatchObject({ pile: 'held', why: 'answered' });
    expect(pileLabel(r, true, NOW).text).toBe('Hoa đã trả lời · chờ khách');
  });

  it('nobody claimed it: needs a person, however short the wait', () => {
    expect(pileOf(owed(1, { state: 'unclaimed' }), NOW)).toMatchObject({ pile: 'needs', why: 'unclaimed', waited: 1 });
    // An older API build sends no customerLast — the server's own waiting timer still counts.
    expect(pileOf(row({ state: 'unclaimed', waitingMinutes: 12 }), NOW)).toMatchObject({ pile: 'needs', waited: 12 });
  });

  it('the auto-reply is off: an unanswered customer is a person\'s job at once', () => {
    expect(pileOf(owed(1, { botOff: true }), NOW)).toMatchObject({ pile: 'needs', why: 'ai-off' });
    expect(pileOf(row({ botOff: true, customerLast: false }), NOW)).toMatchObject({ pile: 'held' });
  });

  it('a goodbye the AI rightly left alone is not work', () => {
    const r = owed(120, { lastText: 'cảm ơn em', closer: true });
    expect(pileOf(r, NOW)).toMatchObject({ pile: 'ai', why: 'closer' });
    expect(pileLabel(r, true, NOW).text).toBe('Khách đã chào · AI không hỏi thêm');
  });

  it('an ad click or an opened chat is not a question', () => {
    expect(pileOf(owed(60, { lastText: '👋 (opened chat)' }), NOW).pile).toBe('ai');
  });

  it('past Meta\'s seven-day window nobody can answer — it stops being work', () => {
    expect(pileOf(owed(8 * 24 * 60), NOW).pile).toBe('ai');
    expect(pileOf(owed(8 * 24 * 60, { state: 'human' }), NOW).pile).toBe('held');
  });

  it('the AI answered: nothing to do', () => {
    const r = row({ customerLast: false, lastCustomerAt: ago(10) });
    expect(pileOf(r, NOW)).toEqual({ pile: 'ai', why: 'ai-answered', waited: null });
    expect(pileLabel(r, true, NOW)).toEqual({ text: 'AI đã trả lời', tone: 'ai' });
  });

  it('done and spam are their own piles and never count as waiting', () => {
    expect(pileOf(owed(300, { state: 'done' }), NOW).pile).toBe('done');
    expect(pileOf(owed(300, { status: 'spam' }), NOW).pile).toBe('spam');
  });

  it('an older API build (no customerLast) falls back to who holds it', () => {
    expect(pileOf(row({ state: 'human' }), NOW).pile).toBe('held');
    expect(pileOf(row({ state: 'bot' }), NOW).pile).toBe('ai');
    expect(waitedMinutes({ lastCustomerAt: ago(9) }, NOW)).toBeNull();
  });
});

describe('the queues', () => {
  const rows: InboxRow[] = [
    owed(4, { id: 'lan', state: 'human', assignedName: 'Hoa', assignedUserId: 'u-hoa' }),
    owed(300, { id: 'kelly' }),
    owed(12, { id: 'bao', state: 'unclaimed' }),
    row({ id: 'thao', customerLast: false }),
    owed(1, { id: 'david' }),
    row({ id: 'held', state: 'human', assignedUserId: 'u-hoa', customerLast: false }),
    row({ id: 'closed', state: 'done', assignedUserId: 'u-hoa' }),
    owed(9, { id: 'junk', status: 'spam' }),
    row({ id: 'fu', customerLast: false, followUpAt: ago(60) }),
  ];

  it('"needs a reply" is worked longest wait first', () => {
    expect(queueRows(rows, 'needs', null, NOW).map((r) => r.id)).toEqual(['kelly', 'bao', 'lan']);
  });

  it('counts each pile once and keeps spam out of everything', () => {
    expect(queueCounts(rows, 'u-hoa', NOW)).toEqual({ needs: 3, ai: 3, followup: 1, due: 1, mine: 2, done: 1, all: 8, spam: 1, longest: 300 });
  });

  it('"mine" leaves out what I already closed', () => {
    expect(queueRows(rows, 'mine', 'u-hoa', NOW).map((r) => r.id)).toEqual(['lan', 'held']);
  });

  it('draws the waiting people first, then what the AI has, then the rest', () => {
    expect(inboxSections(rows, 'needs', null, NOW).map((s) => [s.key, s.rows.length])).toEqual([['needs', 3], ['ai', 3]]);
    expect(inboxSections(rows, 'all', null, NOW).map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ['needs', ['kelly', 'bao', 'lan']], ['ai', ['thao', 'david', 'fu']], ['rest', ['held', 'closed']],
    ]);
    expect(inboxSections(rows, 'spam', null, NOW)).toEqual([{ key: 'rest', rows: [rows[7]] }]);
    expect(inboxSections([], 'needs', null, NOW)).toEqual([]);
  });
});

describe('how a wait is said', () => {
  it.each([[0, 'vừa xong'], [4, '4 phút'], [59, '59 phút'], [60, '1 giờ'], [300, '5 giờ'], [2 * 24 * 60 + 5, '2 ngày']])('%i minutes → %s', (m, text) => {
    expect(waitText(m as number, true)).toBe(text);
  });
});
