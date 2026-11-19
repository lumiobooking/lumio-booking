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

describe('a reply Meta never got is said on screen', () => {
  const NOW = new Date('2026-10-24T04:30:00Z');
  const meta = [
    { role: 'assistant' as const, content: 'Hi Van! Please let us know how we can help you.', at: '2026-10-24T04:11:24Z', messageId: 'm1' },
    { role: 'user' as const, content: 'Giá cả của gói Marketing Lumio là bao nhiêu?', at: '2026-10-24T04:11:25Z', messageId: 'm2' },
    { role: 'assistant' as const, content: 'Dạ em sẽ gửi báo giá qua cho chị ạ', at: '2026-10-24T04:17:54Z', messageId: 'm3' },
  ];
  it('the bot line Meta does not have, minutes later, is marked undelivered', () => {
    const local = [{ role: 'assistant' as const, content: 'Dạ, giá bên em tuỳ theo tiệm…', at: '2026-10-24T04:11:35Z' }];
    const out = mergeHistory(meta, local, NOW);
    expect(out.find((t) => t.content.startsWith('Dạ, giá'))?.undelivered).toBe(true);
    expect(out.filter((t) => t.undelivered)).toHaveLength(1);
  });
  it('not a reply sent a moment ago, not a photo line, not one older than Meta\'s page, not a known failure', () => {
    const local = [
      { role: 'assistant' as const, content: 'just now', at: '2026-10-24T04:29:00Z' },
      { role: 'assistant' as const, content: '[Đã gửi 2 ảnh: bảng giá]', at: '2026-10-24T04:12:00Z' },
      { role: 'assistant' as const, content: 'from last month', at: '2026-09-01T10:00:00Z' },
      { role: 'assistant' as const, content: 'refused', at: '2026-10-24T04:13:00Z', failed: true },
    ];
    expect(mergeHistory(meta, local, NOW).filter((t) => t.undelivered)).toHaveLength(0);
  });
});

describe("Meta's ad notice is never 'undelivered'", () => {
  it('the local "replied to an ad" line Meta has no copy of stays quiet', () => {
    const NOW = new Date('2026-10-23T16:00:00Z');
    const meta = [
      { role: 'assistant' as const, content: 'Hi Linda! Please let us know how we can help you.', at: '2026-10-23T15:05:15Z', messageId: 'm1' },
      { role: 'user' as const, content: 'Do I need to book an appointment in advance?', at: '2026-10-23T15:05:16Z', messageId: 'm2' },
    ];
    const local = [{ role: 'assistant' as const, content: 'Linda Cain Sperling replied to an ad.', at: '2026-10-23T15:05:15Z', manual: true }];
    expect(mergeHistory(meta, local, NOW).filter((t) => t.undelivered)).toHaveLength(0);
  });
});

describe('rt201 — a reply the customer got is never called undelivered', () => {
  const T0 = new Date('2026-11-19T07:36:00Z');
  const NOW2 = new Date(T0.getTime() + 60 * 60_000);
  const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();
  const cust = { role: 'user' as const, content: 'Giá thế nào?', at: at(-30) };

  it('an AI reply sent as two bubbles is one reply, delivered, keeping its details', () => {
    const reply = 'Gói Basic $29/tháng và gói Pro $69/tháng.\n\nAnh/chị cho em xin tên tiệm và thành phố để team kiểm tra khu vực ạ?';
    const local: HistoryTurn[] = [cust, { role: 'assistant', content: reply, at: at(0), why: { n: 6 } } as unknown as HistoryTurn];
    const meta: HistoryTurn[] = [cust,
      { role: 'assistant', content: 'Gói Basic $29/tháng và gói Pro $69/tháng.', at: at(1), messageId: 'm_1' } as HistoryTurn,
      { role: 'assistant', content: 'Anh/chị cho em xin tên tiệm và thành phố để team kiểm tra khu vực ạ?', at: at(2), messageId: 'm_2' } as HistoryTurn];
    const out = mergeHistory(meta, local, NOW2);
    expect(out.filter((t) => t.undelivered)).toHaveLength(0);
    const mine = out.filter((t) => t.role === 'assistant');
    expect(mine).toHaveLength(1);
    expect((mine[0] as unknown as { why?: unknown }).why).toEqual({ n: 6 });
  });

  it('a staff reply typed in decomposed Vietnamese (NFD) matches Meta’s composed copy', () => {
    const typed = 'Dạ chị ơi, tiệm còn chỗ lúc 3 giờ ạ'.normalize('NFD');
    const local: HistoryTurn[] = [cust, { role: 'assistant', content: typed, at: at(0), manual: true } as HistoryTurn];
    const meta: HistoryTurn[] = [cust, { role: 'assistant', content: typed.normalize('NFC'), at: at(1) } as HistoryTurn];
    expect(mergeHistory(meta, local, NOW2).filter((t) => t.undelivered)).toHaveLength(0);
  });

  it('a staff reply is proven by Meta’s message id, whatever the spacing', () => {
    const local: HistoryTurn[] = [cust, { role: 'assistant', content: 'Dạ   em gửi chị\n\n bảng giá ạ ', at: at(0), manual: true, messageId: 'm_77' } as HistoryTurn];
    const meta: HistoryTurn[] = [cust, { role: 'assistant', content: 'Dạ em gửi chị bảng giá ạ', at: at(1), messageId: 'm_77' } as HistoryTurn];
    const out = mergeHistory(meta, local, NOW2);
    expect(out.filter((t) => t.undelivered)).toHaveLength(0);
    expect(out.filter((t) => t.role === 'assistant')).toHaveLength(1);
  });

  it('a long reply Meta holds cut at its limit is delivered', () => {
    const long = 'Dạ '.repeat(800).trim();
    const local: HistoryTurn[] = [cust, { role: 'assistant', content: long, at: at(0), manual: true } as HistoryTurn];
    const meta: HistoryTurn[] = [cust, { role: 'assistant', content: long.slice(0, 1900), at: at(1) } as HistoryTurn];
    expect(mergeHistory(meta, local, NOW2).filter((t) => t.undelivered)).toHaveLength(0);
  });

  it('a reply Meta truly does not have is still flagged', () => {
    const local: HistoryTurn[] = [cust, { role: 'assistant', content: 'Tin này không tới khách được', at: at(0), manual: true } as HistoryTurn];
    const meta: HistoryTurn[] = [cust, { role: 'assistant', content: 'Một tin khác hoàn toàn', at: at(-10) } as HistoryTurn];
    expect(mergeHistory(meta, local, NOW2).filter((t) => t.undelivered)).toHaveLength(1);
  });

  it('one Meta message never proves two of our replies', () => {
    const local: HistoryTurn[] = [cust,
      { role: 'assistant', content: 'Dạ vâng ạ', at: at(0), manual: true } as HistoryTurn,
      { role: 'assistant', content: 'Dạ vâng ạ'.normalize('NFD'), at: at(60), manual: true } as HistoryTurn];
    const meta: HistoryTurn[] = [cust, { role: 'assistant', content: 'dạ vâng ạ', at: at(1) } as HistoryTurn];
    expect(mergeHistory(meta, local, NOW2).filter((t) => t.undelivered)).toHaveLength(1);
  });
});
