import { isWorkNext, workNextOf } from './work-next';

describe('who is up next on a salon', () => {
  it('accepts the five departments and a clear, nothing else', () => {
    for (const v of ['content', 'design', 'review', 'schedule', 'done', '']) expect(isWorkNext(v)).toBe(true);
    for (const v of ['boss', null, undefined, 3]) expect(isWorkNext(v)).toBe(false);
  });

  it('reads what is stored, and junk as not picked', () => {
    expect(workNextOf({ next: 'design', at: 'x', by: 'a' })).toBe('design');
    expect(workNextOf({ next: 'boss' })).toBe('');
    expect(workNextOf(null)).toBe('');
  });
});
