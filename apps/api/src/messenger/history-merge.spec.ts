import { mergeHistory, HistoryTurn } from './history-merge';

const u = (content: string, over: Partial<HistoryTurn> = {}): HistoryTurn => ({ role: 'user', content, ...over });
const a = (content: string, over: Partial<HistoryTurn> = {}): HistoryTurn => ({ role: 'assistant', content, ...over });

describe('what a person actually reads when they open a conversation', () => {
  it('shows Meta’s full transcript, not our 12-turn buffer', () => {
    // The bug this was written for: a long conversation opened showing only
    // the tail, because the buffer the BOT uses to remember was being drawn on
    // screen as though it were the conversation.
    const meta = [u('m1'), a('r1'), u('m2'), a('r2'), u('m3'), a('r3')];
    const local = [u('m3'), a('r3')];
    expect(mergeHistory(meta, local).map((t) => t.content)).toEqual(['m1', 'r1', 'm2', 'r2', 'm3', 'r3']);
  });

  it('shows the conversation even when our buffer is completely empty', () => {
    // A row created by the name backfill has no history at all. It used to
    // open blank: a customer plainly visible in the list, and nothing when you
    // clicked them.
    expect(mergeHistory([u('xin chào'), a('dạ em nghe')], [])).toHaveLength(2);
  });

  it('keeps our buffer when Meta cannot be asked', () => {
    // null means "we do not know", which is NOT "there are none". Showing an
    // empty conversation because a network call failed would look exactly like
    // a customer who never wrote.
    const local = [u('hi'), a('dạ')];
    expect(mergeHistory(null, local)).toEqual(local);
    expect(mergeHistory(undefined, local)).toEqual(local);
    expect(mergeHistory([], local)).toEqual(local);
  });

  it('shows nothing rather than throwing when there is nothing anywhere', () => {
    expect(mergeHistory(null, [])).toEqual([]);
    expect(mergeHistory([], [])).toEqual([]);
  });
});

describe('telling the bot’s words apart from a person’s', () => {
  // Meta cannot do this: both leave through the Page and look identical to it.
  // It is the entire reason this inbox exists rather than Business Suite.
  it('marks a Page message as manual when our buffer says a human typed it', () => {
    const meta = [u('giá bao nhiêu'), a('Dạ 25$ ạ')];
    const local = [a('Dạ 25$ ạ', { manual: true })];
    const out = mergeHistory(meta, local);
    expect(out[1].manual).toBe(true);
  });

  it('leaves the bot’s own replies unmarked', () => {
    const meta = [u('hi'), a('Dạ em nghe ạ')];
    const local = [u('hi'), a('Dạ em nghe ạ')];
    expect(mergeHistory(meta, local)[1].manual).toBeFalsy();
  });

  it('does not mistake a customer’s words for a staff reply that says the same thing', () => {
    // "ok" gets typed by both sides constantly. Matching must respect who said
    // it, or the customer's messages start appearing as staff replies.
    const meta = [u('ok'), a('ok')];
    const local = [a('ok', { manual: true })];
    const out = mergeHistory(meta, local);
    expect(out[0].role).toBe('user');
    expect(out[0].manual).toBeFalsy();
    expect(out[1].manual).toBe(true);
  });
});

describe('messages Meta does not have', () => {
  it('KEEPS A FAILED SEND — the one message somebody has to act on', () => {
    // Facebook rejected it, so Meta will never list it. If the merge trusted
    // Meta alone, the only evidence that a customer was left unanswered would
    // disappear from the screen.
    const meta = [u('còn chỗ không em')];
    const local = [u('còn chỗ không em'), a('Dạ còn ạ', { manual: true, failed: true })];
    const out = mergeHistory(meta, local);
    expect(out).toHaveLength(2);
    expect(out[1].failed).toBe(true);
  });

  it('keeps a reply sent seconds ago that Meta has not caught up with', () => {
    const meta = [u('hi')];
    const local = [u('hi'), a('Dạ em nghe ạ', { manual: true })];
    expect(mergeHistory(meta, local).map((t) => t.content)).toEqual(['hi', 'Dạ em nghe ạ']);
  });

  it('appends the late ones at the end, where the newest messages belong', () => {
    const meta = [u('m1'), a('r1')];
    const local = [a('r2', { manual: true })];
    expect(mergeHistory(meta, local).map((t) => t.content)).toEqual(['m1', 'r1', 'r2']);
  });
});

describe('not showing the same message twice', () => {
  it('does not duplicate a turn both copies have', () => {
    const both = [u('hi'), a('dạ')];
    expect(mergeHistory(both, both)).toHaveLength(2);
  });

  it('treats text that differs only by surrounding spaces as the same message', () => {
    expect(mergeHistory([a('dạ em nghe')], [a('  dạ em nghe  ', { manual: true })])).toHaveLength(1);
  });

  it('does not duplicate a repeated local turn', () => {
    // Somebody sends "alo" twice. Meta has it once so far; we must not end up
    // showing it three times.
    const out = mergeHistory([u('alo')], [u('alo'), u('alo')]);
    expect(out).toHaveLength(1);
  });
});

describe('rubbish in the data', () => {
  it('drops empty and whitespace-only turns from both sides', () => {
    const out = mergeHistory(
      [u('hi'), a(''), a('   ')],
      [a('', { manual: true })],
    );
    expect(out.map((t) => t.content)).toEqual(['hi']);
  });

  it('survives nulls in either list', () => {
    const out = mergeHistory([u('hi'), null as never], [null as never, a('dạ')]);
    expect(out.map((t) => t.content)).toEqual(['hi', 'dạ']);
  });

  it('never mutates what it was given', () => {
    const meta = [a('dạ')];
    const local = [a('dạ', { manual: true })];
    mergeHistory(meta, local);
    expect(meta[0].manual).toBeUndefined();
  });
});
