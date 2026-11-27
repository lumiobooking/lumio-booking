import { periodLabel, ratingLabel, secText } from './lead-report-view';

describe('rt245 lead report labels', () => {
  it('labels days, weeks and months', () => {
    expect(periodLabel('2026-11-27', 'day', true)).toBe('T6 27/11');
    expect(periodLabel('2026-11-23', 'week', true)).toBe('23/11–29/11');
    expect(periodLabel('2026-11', 'month', true)).toBe('11/2026');
  });
  it('reads answer times', () => {
    expect(secText(45, true)).toBe('45s');
    expect(secText(95, true)).toBe('1p 35s');
    expect(secText(4000, true)).toBe('1g 6p');
    expect(secText(null, true)).toBe('—');
  });
  it('names the ratings', () => expect(ratingLabel('weak', true)).toBe('Cần cải thiện'));
});
