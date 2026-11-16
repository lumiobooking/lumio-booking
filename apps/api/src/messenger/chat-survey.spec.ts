import { shouldAskSurvey, surveyAnswer, surveyAsk, surveyPending, surveySettingFrom, surveyStats, surveyThanks, type SurveyTurn } from './chat-survey';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ask = (h: number): SurveyTurn => ({ role: 'assistant', content: 'Trải nghiệm đặt lịch thế nào ạ?', at: at(h), survey: 'ask' });

describe('the one-tap survey after an AI booking', () => {
  it('is off until the salon switches it on', () => {
    expect(surveySettingFrom(null).on).toBe(false);
    expect(surveySettingFrom('{"on":true}').on).toBe(true);
    expect(surveySettingFrom({ on: 'yes' }).on).toBe(false);
    expect(surveySettingFrom('not json').on).toBe(false);
  });

  it('the buttons are in the customer’s own words — nobody is made to say "em"', () => {
    for (const vi of [true, false]) for (const c of surveyAsk(vi).choices) expect(c.toLowerCase()).not.toMatch(/\bem\b/);
    expect(surveyAsk(true).choices).toEqual(['Hài lòng', 'Bình thường', 'Chưa ổn']);
  });

  it('asks only after a booking, when on, and not twice in 30 days', () => {
    expect(shouldAskSurvey({ on: true, booked: true, history: [], nowMs: NOW })).toBe(true);
    expect(shouldAskSurvey({ on: false, booked: true, history: [], nowMs: NOW })).toBe(false);
    expect(shouldAskSurvey({ on: true, booked: false, history: [], nowMs: NOW })).toBe(false);
    expect(shouldAskSurvey({ on: true, booked: true, history: [ask(24 * 10)], nowMs: NOW })).toBe(false);
    expect(shouldAskSurvey({ on: true, booked: true, history: [ask(24 * 31)], nowMs: NOW })).toBe(true);
  });

  it('a rating is exactly one of the buttons, in either language, typed or tapped', () => {
    expect(surveyAnswer('Hài lòng')).toBe('good');
    expect(surveyAnswer('hai long!')).toBe('good');
    expect(surveyAnswer('Bình thường')).toBe('ok');
    expect(surveyAnswer('Chưa ổn')).toBe('bad');
    expect(surveyAnswer('Not good')).toBe('bad');
    expect(surveyAnswer('bình thường thôi, mà mai mấy giờ mở cửa?')).toBeNull();
    expect(surveyAnswer('ok')).toBeNull();
    expect(surveyAnswer('')).toBeNull();
  });

  it('the question is open only as our last word, for a day', () => {
    expect(surveyPending([{ role: 'user', content: 'ok 2pm', at: at(2) }, { role: 'assistant', content: 'Booked', at: at(1.1) }, ask(1)], NOW)).toBe(true);
    expect(surveyPending([ask(25)], NOW)).toBe(false);
    expect(surveyPending([ask(2), { role: 'user', content: 'mai mấy giờ mở cửa?', at: at(1) }], NOW)).toBe(false);
    expect(surveyPending([ask(2), { role: 'assistant', content: 'Nhắc lịch…', at: at(1) }], NOW)).toBe(false);
    expect(surveyPending([ask(2), { role: 'assistant', content: 'Còn cần em hỗ trợ không ạ?', at: at(1), nudge: true }], NOW)).toBe(true);
    expect(surveyPending([], NOW)).toBe(false);
  });

  it('"Chưa ổn" gets an apology and a question; the others a thank-you', () => {
    expect(surveyThanks('bad', true)).toContain('xin lỗi');
    expect(surveyThanks('good', true)).toContain('cảm ơn');
    expect(surveyThanks('ok', false)).toContain('Thank you');
  });

  it('counts the period’s questions and ratings; happy = good / answered', () => {
    const threads = [
      { history: [ask(5), { role: 'user', content: 'Hài lòng', at: at(4), survey: 'good' } as SurveyTurn] },
      { history: [ask(5), { role: 'user', content: 'Chưa ổn', at: at(4), survey: 'bad' } as SurveyTurn] },
      { history: [ask(3)] },
      { history: [ask(24 * 40), { role: 'user', content: 'Hài lòng', at: at(24 * 40 - 1), survey: 'good' } as SurveyTurn] },
    ];
    const s = surveyStats(threads, NOW - 30 * 86_400_000, NOW);
    expect(s).toEqual({ asked: 3, answered: 2, good: 1, ok: 0, bad: 1, happyRate: 0.5 });
    expect(surveyStats([], 0, NOW).happyRate).toBeNull();
  });
});
