/** Thẻ khách: new vs regular, and whether she has seen this client before. */
import { regularLine } from './client-card-ui';

describe('regularLine', () => {
  it('new, regular with her, regular but first time with her', () => {
    expect(regularLine({ firstVisit: true, visits: 0, withMe: 0, lastVisit: null, lastWithMe: null }, true)).toContain('Khách mới');
    expect(regularLine({ firstVisit: false, visits: 7, withMe: 3, lastVisit: '2026-09-20', lastWithMe: '2026-09-20' }, true)).toBe('Khách quen · 7 lần · lần cuối 2026-09-20 · 3 lần với bạn');
    expect(regularLine({ firstVisit: false, visits: 7, withMe: 0, lastVisit: null, lastWithMe: null }, false)).toBe('Regular · 7 visits · first time with you');
  });
});
