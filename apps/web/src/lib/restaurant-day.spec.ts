import { addDaysKey, bizDayKey, bizWindow, changePct, checkNoOf, methodOf, nightStats, nightsOpen, tableOf, type BizOrder } from './restaurant-day';

const TZ = 'Asia/Ho_Chi_Minh';
const o = (n: number, at: string, total: number, extra: Partial<BizOrder> = {}): BizOrder => ({
  id: `o${n}`, orderNumber: n, status: 'PAID', note: 'Bàn 1 · #10', subtotalCents: total, discountCents: 0, totalCents: total,
  createdAt: at, paidAt: at, tenders: [{ method: 'CASH', amountCents: total }], ...extra,
});

describe('a restaurant night', () => {
  it('a 01:43 bill belongs to the night before; 04:00 starts a new day', () => {
    expect(bizDayKey('2026-11-17T18:43:00Z', 4, TZ)).toBe('2026-11-17'); // 01:43 on the 18th, Vietnam
    expect(bizDayKey('2026-11-17T20:59:00Z', 4, TZ)).toBe('2026-11-17'); // 03:59
    expect(bizDayKey('2026-11-17T21:00:00Z', 4, TZ)).toBe('2026-11-18'); // 04:00
    expect(bizDayKey('2026-11-17T18:43:00Z', 0, TZ)).toBe('2026-11-18'); // a salon: midnight, as before
  });

  it('one night as a window of instants', () => {
    expect(bizWindow('2026-11-17', 4, TZ)).toEqual({ from: '2026-11-16T21:00:00.000Z', to: '2026-11-17T20:59:59.999Z' });
    expect(addDaysKey('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('counts only that night: money, bills, discounts, methods, hours', () => {
    const orders = [
      o(1, '2026-11-17T12:30:00Z', 300000), // 19:30
      o(2, '2026-11-17T13:10:00Z', 500000, { subtotalCents: 1000000, discountCents: 500000, tenders: [{ method: 'TRANSFER', amountCents: 500000 }] }),
      o(3, '2026-11-17T18:43:00Z', 200000), // 01:43 next morning — same night
      o(4, '2026-11-16T15:00:00Z', 999999), // the night before
    ];
    const s = nightStats(orders, '2026-11-17', 4, TZ);
    expect(s.bills).toBe(3);
    expect(s.netCents).toBe(1000000);
    expect(s.discountCents).toBe(500000);
    expect(s.bigDiscounts.map((x) => x.orderNumber)).toEqual([2]);
    expect(s.byMethod).toEqual({ cash: 500000, transfer: 500000, card: 0, other: 0 });
    expect(s.transferBills).toBe(1);
    expect(s.byHour.map((h) => h.hour)).toEqual([19, 20, 1]); // in the order of the night, not the clock
    expect(s.avgCents).toBe(333333);
  });

  it('a bill taken back is shown beside the bill charged again on the same table', () => {
    const orders = [
      o(88, '2026-11-17T12:48:00Z', 1850000, { status: 'VOID', note: 'Bàn 11 + Bàn 12 · #126' }),
      o(89, '2026-11-17T12:58:00Z', 1232000, { note: 'Bàn 26 · #135' }),
      o(91, '2026-11-17T13:02:00Z', 1522800, { note: 'Bàn 11 · #147' }),
    ];
    const s = nightStats(orders, '2026-11-17', 4, TZ);
    expect(s.voidedCents).toBe(1850000);
    expect(s.voided[0].replacement?.orderNumber).toBe(91);
    expect(s.bills).toBe(2);
  });

  it('nights a shift has been open, and the table and ticket on a bill', () => {
    expect(nightsOpen('2026-11-15T09:59:00Z', new Date('2026-11-18T08:42:00Z'), 4, TZ)).toBe(3);
    expect(nightsOpen('2026-11-18T10:00:00Z', new Date('2026-11-18T18:00:00Z'), 4, TZ)).toBe(0);
    expect(tableOf({ note: 'Bàn 7 · #148' })).toBe('Bàn 7');
    expect(checkNoOf({ note: 'Bàn 7 · #148' })).toBe(148);
    expect(tableOf({ note: null })).toBe('—');
    expect(methodOf('momo')).toBe('transfer');
    expect(changePct(118, 100)).toBe(18);
    expect(changePct(5, 0)).toBeNull();
  });
});
