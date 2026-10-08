/**
 * The narrative guard: a figure in the AI's text must be in the data; alarm
 * words are banned while the month runs. And the month lifecycle / send policy.
 */
import { figuresIn, numbersIn, guardNarrative, correctionFor } from './report-guard';
import { cleanReportPolicy, lifecycleOf, autoSendDue, daysAfterMonth, nextActionOf, DEFAULT_REPORT_POLICY } from './report-lifecycle';

describe('figures in a sentence', () => {
  it('reads thousands, decimals, percents and currency; ignores years, dates, times and tiny counts', () => {
    expect(figuresIn('Reach 12,400 (+18%), 2 bài, 450.000đ, 3.5 sao, tháng 10/2026 lúc 10:30, ngày 8')).toEqual(['12400', '18', '450000', '3.5']);
    expect(figuresIn('Mỗi $1 chi ra → $4.2 doanh thu; 1.234.567đ')).toEqual(['4.2', '1234567']); // "$1" is prose
    expect(figuresIn('Không có số')).toEqual([]);
  });
});

describe('numbers in the data', () => {
  it('knows cents, rounding and k/million spellings', () => {
    const s = numbersIn({ revenueCents: 123456, reachPct: 18.4, followers: 12400, nested: [{ n: '2,500' }] });
    expect(s.has('123456')).toBe(true);
    expect(s.has('1234.56')).toBe(true);   // cents → $
    expect(s.has('1235')).toBe(true);
    expect(s.has('18')).toBe(true);        // rounded percent
    expect(s.has('18.4')).toBe(true);
    expect(s.has('12.4')).toBe(true);      // 12.4k
    expect(s.has('2500')).toBe(true);
    expect(s.has('999')).toBe(false);
  });
});

describe('guarding the narrative', () => {
  const data = { posts: 7, interactions: 288, reach: 12400, vsPrev: { pct: 18 } };
  it('passes text whose figures are all in the data', () => {
    const g = guardNarrative({ headline: { vi: 'Reach tăng 18% với 7 bài', en: 'Reach up 18% on 7 posts' }, highlights: [{ vi: '288 tương tác', en: '288 interactions' }] }, data, false);
    expect(g.ok).toBe(true);
  });
  it('flags a figure the AI made up, with its path', () => {
    const g = guardNarrative({ tldr: { vi: 'Reach 15.000 người', en: 'Reached 15,000 people' }, _aiUnavailable: true }, data, false);
    expect(g.ok).toBe(false);
    expect(g.stray).toEqual([{ path: 'tldr.vi', figure: '15000' }, { path: 'tldr.en', figure: '15000' }]);
    expect(correctionFor(g)).toMatch(/15000/);
  });
  it('next month’s plan and KPI targets may carry new figures — they are proposals', () => {
    const g = guardNarrative({ nextMonth: { kpi: [{ vi: 'Reach IG ≥ 14.000 (hiện 12.400)', en: 'IG reach ≥ 14,000 (now 12,400)' }] }, plan: [{ vi: 'Thử 2.000.000đ quảng cáo', en: 'Try $80 of ads' }] }, data, false);
    expect(g.ok).toBe(true);
  });
  it('bans alarm language only while the month is running, only in headline/tldr/summary', () => {
    const c = { headline: { vi: 'Reach giảm mạnh, cần hành động ngay', en: 'Reach fell sharply; immediate action needed' }, issues: [{ vi: 'giảm mạnh ở FB', en: 'fell sharply on FB' }] };
    expect(guardNarrative(c, data, true).alarms).toEqual(['headline.vi', 'headline.en']);
    expect(guardNarrative(c, data, false).alarms).toEqual([]);
    expect(correctionFor(guardNarrative(c, data, true))).toMatch(/still in progress/);
  });
});

describe('month lifecycle and send policy', () => {
  it('collecting → closing → none/draft → approved → sent', () => {
    expect(lifecycleOf('2026-10', null, '2026-10-08')).toBe('collecting');
    expect(lifecycleOf('2026-10', null, '2026-11-02')).toBe('closing');
    expect(lifecycleOf('2026-10', null, '2026-11-06')).toBe('none');
    expect(lifecycleOf('2026-10', { status: 'review' }, '2026-11-06')).toBe('draft');
    expect(lifecycleOf('2026-10', { status: 'approved' }, '2026-11-06')).toBe('approved');
    expect(lifecycleOf('2026-10', { status: 'approved', sentAt: new Date() }, '2026-11-06')).toBe('sent');
    expect(daysAfterMonth('2026-12', '2027-01-01')).toBe(1);
  });
  it('policy is cleaned; auto-send goes out on/after sendDay of the next month, once, not months later', () => {
    expect(cleanReportPolicy({ autoSend: true, sendDay: 3, extraRecipients: ['Owner@Shop.com', 'bad', 'Owner@Shop.com'] })).toEqual({ autoSend: true, sendDay: 3, extraRecipients: ['owner@shop.com'] });
    expect(cleanReportPolicy({ sendDay: 99 })).toEqual(DEFAULT_REPORT_POLICY);
    const p = { autoSend: true, sendDay: 5, extraRecipients: [] };
    expect(autoSendDue('2026-10', { status: 'review' }, p, '2026-11-04')).toBe(false);
    expect(autoSendDue('2026-10', { status: 'review' }, p, '2026-11-05')).toBe(true);
    expect(autoSendDue('2026-10', { status: 'approved' }, p, '2026-11-20')).toBe(true);
    expect(autoSendDue('2026-10', { status: 'sent' }, p, '2026-11-20')).toBe(false);
    expect(autoSendDue('2026-10', null, p, '2026-11-20')).toBe(false);
    expect(autoSendDue('2026-10', { status: 'review' }, { ...p, autoSend: false }, '2026-11-20')).toBe(false);
    expect(autoSendDue('2026-08', { status: 'review' }, p, '2026-11-20')).toBe(false); // too old
    expect(nextActionOf('draft', p)).toBe('auto-send');
    expect(nextActionOf('approved', DEFAULT_REPORT_POLICY)).toBe('send');
  });
});
