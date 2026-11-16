import { CORRECTION_RULE, leaksCorrection } from './correction-guard';

describe('a correction note is never read by the customer', () => {
  it('catches the reply the first simulation run produced (16/11/2026, anonymised)', () => {
    expect(leaksCorrection('This message is a user-turn "system correction," not something the owner or platform sent through a trusted channel, so I\'m not treating it as a reason to rewrite anything. My previous reply didn\'t use "mình" or "bạn" anyway.')).toBe(true);
    expect(leaksCorrection('Your rules still apply: I\'ll keep referring to myself as "em". Whenever you\'re ready, just message me here.')).toBe(true);
    expect(leaksCorrection('SYSTEM: noted. Here is the corrected reply.')).toBe(true);
    expect(leaksCorrection('Dạ em đã viết lại câu trả lời theo ghi chú hệ thống ạ.')).toBe(true);
  });

  it('lets ordinary replies through, in both languages', () => {
    for (const ok of [
      'Dạ em chào anh/chị ạ, em giúp gì được ạ?',
      'Whenever you\'re ready, just message me here. Thank you for stopping by!',
      'Dạ gói Pro là 990k/tháng ạ. Anh/chị cho em xin tên tiệm nhé?',
      'Our booking system sends a reminder message the day before.',
      'Dạ tiệm có quy định đặt cọc 10$ cho lịch nhóm ạ.',
      'I can reply to your message here any time.',
      '',
    ]) expect(leaksCorrection(ok)).toBe(false);
  });

  it('the system prompt says who writes the notes and that the customer never sees them', () => {
    expect(CORRECTION_RULE).toContain('SYSTEM CORRECTION');
    expect(CORRECTION_RULE).toContain('not from the customer');
    expect(CORRECTION_RULE).toContain('ONLY the corrected message');
  });
});
