import { needsAnswer, silentQuestionPush } from './agent-fallback';
import { saysStop } from './followup';

describe('a question the AI stayed silent on reaches a person', () => {
  it('reads questions in English and Vietnamese', () => {
    for (const q of ['where are you located?', 'Where are you location', 'How much do you charge for hair stroke brows', 'Is Scalp Micropigmentation permanent', 'giá bao nhiêu', 'tiệm ở đâu']) expect(needsAnswer(q)).toBe(true);
  });
  it('not a question: thanks, ok, a statement', () => {
    for (const q of ['Thank you', 'Ok', 'I’ll contact you tomorrow. Spending today with my daughter', '']) expect(needsAnswer(q)).toBe(false);
  });
  it('the push names the customer', () => {
    expect(silentQuestionPush('Mercy Hardman', false).title).toMatch(/^Mercy Hardman asked/);
    expect(silentQuestionPush(null, true).title).toMatch(/^Khách đang hỏi/);
  });
});

describe('opt-out words stop the AI before it runs', () => {
  it('Unsubscribe / STOP / do not message me', () => {
    for (const t of ['Unsubscribe', 'Stop UNSUBSCRIBE', 'STOP', 'please stop messaging me', 'đừng nhắn nữa']) expect(saysStop(t)).toBe(true);
  });
  it('ordinary sentences are not an opt-out', () => {
    for (const t of ['I want to stop drawing my brows every morning', 'hủy lịch thứ Ba', 'Not sure never had anything like this done']) expect(saysStop(t)).toBe(false);
  });
});
