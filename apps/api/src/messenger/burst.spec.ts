import { mergeBurst, alreadySaid, repeatCount, repeatVerdict } from './burst';

describe('mergeBurst', () => {
  it('COLLAPSES the same button tapped five times into one turn', () => {
    // The screenshot this was written from: five identical quick replies, five
    // identical paragraphs back.
    expect(mergeBurst(Array(5).fill('Tư vấn gói này'))).toBe('Tư vấn gói này');
  });

  it('keeps different lines, in order — three keystrokes are one thought', () => {
    expect(mergeBurst(['Tôi tên An', 'SĐT 0909111222', 'Thứ 5 nhé']))
      .toBe('Tôi tên An\nSĐT 0909111222\nThứ 5 nhé');
  });

  it('reads a repeat through spacing and case', () => {
    expect(mergeBurst(['Tư vấn gói này', '  tư   vấn gói NÀY  '])).toBe('Tư vấn gói này');
  });

  it('drops blanks rather than turning them into empty lines', () => {
    expect(mergeBurst(['alo', '   ', '', 'còn chỗ không ạ'])).toBe('alo\ncòn chỗ không ạ');
    expect(mergeBurst([])).toBe('');
  });
});

describe('alreadySaid', () => {
  const now = Date.parse('2026-09-09T10:00:00Z');
  const min = (n: number) => new Date(now - n * 60_000).toISOString();
  const line = 'Dạ, giá phù hợp tùy vào từng tiệm ạ.';

  it('STOPS the same paragraph going out twice in a row', () => {
    const h = [{ role: 'user', content: 'giá bao nhiêu' }, { role: 'assistant', content: line, at: min(1) }];
    expect(alreadySaid(h, line, now)).toBe(true);
  });

  it('lets it through when the previous copy never reached the customer', () => {
    // Zalo refused the last reply (token, window, quota — whatever). The
    // customer saw nothing, so the same words now are not a stutter.
    const h = [{ role: 'user', content: 'xin chào' }, { role: 'assistant', content: line, at: min(1), failed: true }];
    expect(alreadySaid(h, line, now)).toBe(false);
  });

  it('lets it through when we said something else in between', () => {
    // Repeating a sentence later in a conversation is normal talking. Only a
    // stutter — the very same thing twice in a row — carries nothing.
    const h = [
      { role: 'assistant', content: line, at: min(9) },
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: 'Dạ em gửi anh bảng giá ạ.', at: min(8) },
    ];
    expect(alreadySaid(h, line, now)).toBe(false);
  });

  it('lets it through once enough time has passed to be worth saying again', () => {
    const h = [{ role: 'assistant', content: line, at: min(45) }];
    expect(alreadySaid(h, line, now)).toBe(false);
  });

  it('ignores spacing and case, which is how two "different" replies are the same one', () => {
    const h = [{ role: 'assistant', content: `  ${line.toUpperCase()}  `, at: min(1) }];
    expect(alreadySaid(h, line, now)).toBe(true);
  });

  it('says no on an empty thread and on an empty reply', () => {
    expect(alreadySaid([], line, now)).toBe(false);
    expect(alreadySaid([{ role: 'assistant', content: line, at: min(1) }], '   ', now)).toBe(false);
  });

  it('treats a turn with no timestamp as recent rather than risk the duplicate', () => {
    expect(alreadySaid([{ role: 'assistant', content: line }], line, now)).toBe(true);
  });
});

describe('the same question again and again (ad button tapped, a spam bot)', () => {
  const now = Date.parse('2026-10-30T15:40:00Z');
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const q = 'Làm thế nào để được tư vấn chi tiết?';

  it('answers the first two times, is silent from the third, moves to Spam from the fifth', () => {
    const h: { role: string; content: string; at: string }[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(repeatVerdict(repeatCount(h, q, now)));
      h.push({ role: 'user', content: q, at: at(20 - i) }, { role: 'assistant', content: 'Dạ anh chị gửi giúp em tên tiệm ạ', at: at(20 - i) });
    }
    expect(seen).toEqual(['answer', 'answer', 'silent', 'silent', 'spam', 'spam']);
  });

  it('spacing and case do not hide a repeat; a line inside a merged burst counts', () => {
    const h = [{ role: 'user', content: '  làm thế nào ĐỂ được tư vấn chi tiết? ', at: at(5) }, { role: 'user', content: 'alo\nLàm thế nào để được tư vấn chi tiết?', at: at(3) }];
    expect(repeatCount(h, q, now)).toBe(2);
  });

  it('older than half an hour, the bot\'s own lines, and different questions do not count', () => {
    const h = [
      { role: 'user', content: q, at: at(45) },
      { role: 'assistant', content: q, at: at(10) },
      { role: 'user', content: 'Giá gói Social Care bao nhiêu?', at: at(5) },
    ];
    expect(repeatCount(h, q, now)).toBe(0);
    expect(repeatVerdict(repeatCount(h, q, now))).toBe('answer');
  });
});

import { BURST_MS as FIXED, SETTLE_EXTRA_MS, SETTLE_MAX, WAIT_COMPLETE_MS, WAIT_DEFAULT_MS, WAIT_FRAGMENT_MS, WAIT_TAP_MS, burstWaitMs, settleMs } from './burst';
describe('the adaptive wait: sized by what the customer just sent', () => {
  it('a tap on a button is answered at once', () => {
    expect(burstWaitMs(['Xem tất cả gói'], { tap: true })).toBe(WAIT_TAP_MS);
    // …unless they had already typed something else in this burst
    expect(burstWaitMs(['cho hỏi', 'Xem tất cả gói'], { tap: true })).not.toBe(WAIT_TAP_MS);
  });

  it('a whole question, in the languages the salons are written to in, waits about a second', () => {
    for (const q of [
      'where are you located?', 'How much for lash extensions', 'Do you have anything tomorrow morning',
      'giá gói marketing', 'tiệm mở cửa lúc mấy giờ', 'có làm mi không', 'còn chỗ chiều nay không', 'cho hỏi giá uốn mi', 'tư vấn gói marketing',
      'cuánto cuesta el gel', 'I would like to book a full set for Saturday afternoon please',
      'tôi muốn đăng ký gói marketing thì làm thế nào',
    ]) expect([q, burstWaitMs([q])]).toEqual([q, WAIT_COMPLETE_MS]);
  });

  it('a greeting or a lone photo means the real message is still coming', () => {
    for (const g of ['hi', 'Hello!', 'alo', 'shop ơi', 'chào em', 'em ơi', 'Good morning', 'hola']) expect([g, burstWaitMs([g])]).toEqual([g, WAIT_FRAGMENT_MS]);
    expect(burstWaitMs(['[Customer sent an attachment]'], { media: true })).toBe(WAIT_FRAGMENT_MS);
  });

  it('a short answer to what was asked — a day, a time, a name, a number — is not made to wait like a greeting', () => {
    for (const a of ['Yes', 'Tuesday', '10am', 'Kim', '239 300 1701', 'ok em', 'Yes please']) expect([a, burstWaitMs([a])]).toEqual([a, WAIT_DEFAULT_MS]);
  });

  it('every wait is far below the fixed six seconds it replaces', () => {
    for (const t of [['hi'], ['giá bao nhiêu'], ['Yes'], [''], []] as string[][]) expect(burstWaitMs(t)).toBeLessThan(FIXED);
  });

  it('another message during the wait? a moment more — a few times at most, never for ever', () => {
    expect(settleMs(9_600, 9_000, 10_000, 0)).toBe(SETTLE_EXTRA_MS);   // a second message 0.4 s ago
    expect(settleMs(9_100, 9_000, 10_000, 0)).toBe(0);                 // it came 0.9 s ago: go
    expect(settleMs(9_000, 9_000, 9_300, 0)).toBe(0);                  // the message the wait began for does not count
    expect(settleMs(9_900, 9_000, 10_000, SETTLE_MAX)).toBe(0);        // enough extensions
    expect(settleMs(undefined, 9_000, 10_000, 0)).toBe(0);
  });
});
