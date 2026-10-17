import { csvLine, dayCsv, type DayReview } from './walkin-day';

/** The end-of-day export: a spreadsheet anyone can open, quoting what needs quoting. */
describe('end-of-day export', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', null, 3])).toBe('a,"b,c","say ""hi""",,3');
  });

  it('has the totals, the open tickets, the technicians, the overrides and the closed-without-payment', () => {
    const d: DayReview = {
      day: '2026-10-17', timezone: 'America/Chicago', closed: null,
      issues: [{ id: 'w1', kind: 'unpaid', name: 'Tina Lee', staffId: 'el', amountCents: 4500, since: '2026-10-17T20:00:00.000Z' }],
      totals: { tickets: 5, done: 3, cancelled: 1, noShows: 1, serviceCents: 12000, avgWaitMin: 11, longestWaitMin: 32 },
      closedUnpaid: [{ walkInId: 'w2', reason: 'paid_elsewhere', note: 'Clover', at: '2026-10-17T21:00:00.000Z', userId: 'u1' }],
      overrides: [{ walkInId: 'w3', suggested: 'ta', chosen: 'el', reason: 'customer_request', at: '2026-10-17T19:00:00.000Z', userId: 'u1' }],
      staff: [{ id: 'el', name: 'Elena' }, { id: 'ta', name: 'Tài' }], users: [{ id: 'u1', name: 'Lan' }],
      techs: [{ staffId: 'el', name: 'Elena', turns: 4, requested: 1, skips: 0, overrides: 1, moneyCents: 26800 }],
    };
    const names = new Map([['el', 'Elena'], ['ta', 'Tài']]);
    const csv = dayCsv(d, { staffName: (id) => (id ? names.get(id) ?? '—' : '—'), userName: (id) => (id === 'u1' ? 'Lan' : ''), vi: true, currency: 'USD' });
    expect(csv).toContain('5,3,1,1,120.00,11,32');
    expect(csv).toContain('Tina Lee,Elena,2026-10-17T20:00:00.000Z,45.00,unpaid');
    expect(csv).toContain('Elena,4,1,0,1,268.00');
    expect(csv).toContain('Tài,Elena,Khách yêu cầu,Lan');
    expect(csv).toContain('Đã thu ở máy khác,Clover,Lan');
  });
});
