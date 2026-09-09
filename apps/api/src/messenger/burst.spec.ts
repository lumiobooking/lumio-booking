import { mergeBurst, alreadySaid } from './burst';

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
