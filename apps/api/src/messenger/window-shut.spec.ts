import { personWindowReason, shutByMeta } from './window-shut';

describe('rt230 — a person refused by Meta is told the real rule', () => {
  it('never says "bot"; says the 7-day rule is about the customer, and what to do', () => {
    const r = personWindowReason(85 * 24);
    expect(r).not.toMatch(/không cho bot/);
    expect(r).toContain('85 ngày');
    expect(r).toContain('7 ngày kể từ tin cuối của KHÁCH');
    expect(r).toMatch(/gọi điện/);
    expect(personWindowReason(null)).toContain('Khách đã lâu không nhắn Page');
  });

  it('inside 7 days, it points to Business Suite instead', () => {
    expect(personWindowReason(3 * 24 + 2)).toContain('Business Suite');
  });
});

describe('rt230 — once Meta says the window is shut, it stays shut until the customer writes', () => {
  const refused = { role: 'assistant', content: 'xin chao', manual: true, failed: true, windowShut: true, at: '2026-11-20T05:01:00Z' };
  it('a refused person’s message after the last customer line shuts the box', () => {
    expect(shutByMeta([{ role: 'user', content: 'hi', at: '2026-08-27T10:00:00Z' }, refused])).toBe(true);
    expect(shutByMeta([refused])).toBe(true);
  });
  it('the customer writing again opens it; an ordinary failure does not shut it', () => {
    expect(shutByMeta([refused, { role: 'user', content: 'alo', at: '2026-11-20T06:00:00Z' }])).toBe(false);
    expect(shutByMeta([{ ...refused, windowShut: undefined }])).toBe(false);
    expect(shutByMeta(null)).toBe(false);
  });
});
