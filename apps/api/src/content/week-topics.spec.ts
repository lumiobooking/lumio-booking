import { topicFor, angleOf, topQuestions } from './week-topics';
import { viOf, enOf, bi } from './i18n';

const PT = {
  most: { label: bi('Mẫu đang được đặt nhiều nhất', 'The set people are booking most') },
  process: { label: bi('Quy trình / cận cảnh tay nghề', 'The process, up close') },
  question: { label: bi('Trả lời một câu khách hay hỏi', 'Answering a question customers keep asking') },
  ba: { label: bi('Trước và sau, hoặc khách phản ứng thật', 'Before and after, or the real reaction') },
  tech: { label: bi('Người thợ và tay nghề của họ', 'The tech and what she can do') },
};

describe('angleOf', () => {
  it('reads each playbook post type by its sense, not its position', () => {
    expect(angleOf(PT.most)).toBe('most-booked');
    expect(angleOf(PT.process)).toBe('process');
    expect(angleOf(PT.question)).toBe('question');
    expect(angleOf(PT.ba)).toBe('before-after');
    expect(angleOf(PT.tech)).toBe('tech');
  });
});

describe('topicFor', () => {
  it('NAMES THE DESIGN AND ITS COUNT instead of "the one booked most"', () => {
    const t = topicFor(PT.most, { mostBooked: { name: 'Dip Powder', count: 41 } });
    expect(viOf(t.subject)).toBe('Dip Powder — mẫu được đặt nhiều nhất tháng này (41 lượt)');
    expect(enOf(t.subject)).toBe('Dip Powder — this month\'s most-booked (41 bookings)');
    expect(t.figure).toEqual({ kind: 'bookings', value: 41 });
  });

  it('prefers a service clearly on the rise over the steady favourite', () => {
    const t = topicFor(PT.most, { mostBooked: { name: 'Dip Powder', count: 41 }, rising: { name: 'Gel-X', pct: 60 } });
    expect(viOf(t.subject)).toMatch(/^Gel-X — đang tăng 60%/);
  });

  it('puts the customer\'s OWN question on the clip, in their words', () => {
    const t = topicFor(PT.question, { question: { text: 'Does dip powder ruin your natural nails?', times: 7 } });
    expect(viOf(t.subject)).toBe('"Does dip powder ruin your natural nails?" — câu khách hỏi nhiều nhất trong inbox');
    expect(t.figure).toEqual({ kind: 'asked', value: 7 });
  });

  it('falls back to the one question every service gets, aimed at the top service', () => {
    const t = topicFor(PT.question, { mostBooked: { name: 'Gel-X', count: 12 } });
    expect(viOf(t.subject)).toBe('"Gel-X giữ được bao lâu?" — câu khách hay hỏi trước khi đặt');
  });

  it('puts the fastest earner and its minutes on the process clip', () => {
    const t = topicFor(PT.process, { bestYield: { name: 'Gel Polish Change', minutes: 20, perHourCents: 7500 } });
    expect(viOf(t.subject)).toBe('Gel Polish Change trong 20 phút — quy trình / cận cảnh tay nghề');
    expect(t.figure).toEqual({ kind: 'minutes', value: 20 });
  });

  it('SAYS THE SHOP CHOOSES rather than inventing a number when there is none', () => {
    const t = topicFor(PT.most, {});
    expect(viOf(t.subject)).toMatch(/tiệm tự chọn/);
    expect(t.figure).toBeNull();
    expect(topicFor(PT.most, { mostBooked: { name: 'X', count: 1 } }).figure).toBeNull();
  });

  it('keeps a long question readable on a phone', () => {
    const long = 'a'.repeat(120) + '?';
    expect(viOf(topicFor(PT.question, { question: { text: long, times: 2 } }).subject).length).toBeLessThan(110);
  });
});

describe('topQuestions', () => {
  const u = (content: string) => ({ role: 'user', content });
  const a = (content: string) => ({ role: 'assistant', content });

  it('finds the question asked most, across threads, in the customer\'s words', () => {
    const qs = topQuestions([
      [u('Hi!'), a('Hello'), u('How much for dip powder?'), a('$45')],
      [u('how much for dip powder'), a('$45')],
      [u('Do you take walk-ins?'), a('Yes')],
      [u('How much for Dip Powder ?')],
    ]);
    expect(qs[0]).toEqual({ text: 'How much for dip powder?', times: 3 });
    expect(qs[1]).toEqual({ text: 'Do you take walk-ins?', times: 1 });
  });

  it('never counts the bot\'s own questions as the customer\'s', () => {
    expect(topQuestions([[a('What time works for you?'), a('Which service?')]])).toEqual([]);
  });

  it('drops greetings, one-word replies and essays', () => {
    expect(topQuestions([[u('ok?'), u('yes'), u('thanks'), u('x'.repeat(200) + '?')]])).toEqual([]);
  });

  it('reads a Vietnamese question without a question mark', () => {
    const qs = topQuestions([[u('Làm bột giá bao nhiêu vậy em')], [u('làm bột giá bao nhiêu vậy em')]]);
    expect(qs[0].times).toBe(2);
  });
});
