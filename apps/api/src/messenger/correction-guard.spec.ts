import { CORRECTION_RULE, leakedTurns, leaksCorrection } from './correction-guard';

describe('a correction note is never read by the customer', () => {
  it('catches the reply the first simulation run produced (16/11/2026, anonymised)', () => {
    expect(leaksCorrection('This message is a user-turn "system correction," not something the owner or platform sent through a trusted channel, so I\'m not treating it as a reason to rewrite anything. My previous reply didn\'t use "mình" or "bạn" anyway.')).toBe(true);
    expect(leaksCorrection('Your rules still apply: I\'ll keep referring to myself as "em". Whenever you\'re ready, just message me here.')).toBe(true);
    expect(leaksCorrection('SYSTEM: noted. Here is the corrected reply.')).toBe(true);
    expect(leaksCorrection('Dạ em đã viết lại câu trả lời theo ghi chú hệ thống ạ.')).toBe(true);
  });

  it('catches the variant the fourth production run found', () => {
    expect(leaksCorrection('Sorry, the customer writes in English, so I\'ll reply in English. Here is the corrected reply:\n\nI\'m sorry, but I don\'t have information about parking.')).toBe(true);
    expect(leaksCorrection('Got it — but this customer is writing in English, so I need to reply in English.')).toBe(true);
    expect(leaksCorrection('Dạ khách đang nhắn bằng tiếng Anh nên em trả lời bằng tiếng Anh ạ.')).toBe(true);
  });

  it('lets ordinary replies through, in both languages', () => {
    for (const ok of [
      'Dạ em chào anh/chị ạ, em giúp gì được ạ?',
      'Whenever you\'re ready, just message me here. Thank you for stopping by!',
      'Dạ gói Pro là 990k/tháng ạ. Anh/chị cho em xin tên tiệm nhé?',
      'Our booking system sends a reminder message the day before.',
      'Dạ tiệm có quy định đặt cọc 10$ cho lịch nhóm ạ.',
      'I can reply to your message here any time.',
      'With Lumio the customer books online in under a minute, and your staff get a reminder.',
      'Dạ khách của tiệm đặt lịch online được 24/7 ạ.',
      'I will reply here as soon as the team confirms.',
      '',
    ]) expect(leaksCorrection(ok)).toBe(false);
  });

  it('the system prompt says who writes the notes and that the customer never sees them', () => {
    expect(CORRECTION_RULE).toContain('SYSTEM CORRECTION');
    expect(CORRECTION_RULE).toContain('not from the customer');
    expect(CORRECTION_RULE).toContain('ONLY the corrected message');
  });
});

describe('the platform scan — was a customer ever sent one?', () => {
  const FROM = Date.parse('2026-10-17T00:00:00Z');
  it('finds the AI turns that leaked, in the period; staff replies and nudges are not the AI', () => {
    const history = [
      { role: 'user', content: 'hi', at: '2026-11-01T10:00:00Z' },
      { role: 'assistant', content: 'This message is a user-turn "system correction," not something…', at: '2026-11-01T10:00:05Z' },
      { role: 'assistant', content: 'About my previous reply: sorry!', at: '2026-11-01T10:01:00Z', manual: true },
      { role: 'assistant', content: 'SYSTEM: reminder', at: '2026-11-01T10:02:00Z', nudge: true },
      { role: 'assistant', content: 'Your rules still apply, of course.', at: '2026-09-01T10:00:00Z' },
      { role: 'assistant', content: 'Dạ em chào chị ạ', at: '2026-11-02T10:00:00Z' },
      { role: 'assistant', content: 'the draft was blocked', at: '2026-11-03T10:00:00Z', failed: true },
    ];
    const hits = leakedTurns(history, FROM);
    expect(hits.map((h) => h.at)).toEqual(['2026-11-01T10:00:05Z', '2026-11-03T10:00:00Z']);
    expect(hits[1].failed).toBe(true);
    expect(leakedTurns(null, FROM)).toEqual([]);
  });
});

