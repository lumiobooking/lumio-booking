import { guessSaleMapping, toSaleRows, saleTemplate } from './sales-import';

describe('past sales file: which column is which', () => {
  it('reads Vietnamese headers, the template, and a Square-style export', () => {
    const vi = saleTemplate(true);
    const m = guessSaleMapping(vi[0]);
    expect([m.date, m.time, m.bill, m.customer, m.phone, m.staff, m.item, m.kind, m.amount, m.tip, m.discount, m.method, m.count]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(guessSaleMapping(saleTemplate(false)[0]).amount).toBe(8);
    const sq = guessSaleMapping(['Date', 'Time', 'Transaction ID', 'Item', 'Team Member', 'Gross Sales', 'Tip Amount', 'Tender Type']);
    expect(sq).toMatchObject({ date: 0, time: 1, item: 3, staff: 4, amount: 5, tip: 6, method: 7 });
  });
  it('rows carry only mapped, non-empty cells; blank lines are dropped', () => {
    const t = saleTemplate(true);
    const rows = toSaleRows([t[1], ['', '', '', '', '', '', '', '', '', '', '', '', '']], guessSaleMapping(t[0]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '14/09/2026', staff: 'Lan', amount: '250.000', tip: '30.000', bill: '101' });
    expect(rows[0].discount).toBeUndefined();
  });
});
