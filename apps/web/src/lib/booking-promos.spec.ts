import { afterPct, anyDealPct, groupPct, inWindow, lineDeal, nextDeal, promoDeal, windowEnded, type Promos } from './booking-promos';

/**
 * "Khi có giảm giá thì hiển thị trên menu luôn" — the menu shows the price the
 * customer will pay, and the booking page agrees with the server about it.
 */

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const grandOpening: Promos = {
  dates: { enabled: true, rules: [{ startDate: '2026-10-02', endDate: '2026-10-25', categoryId: null, percent: 20, label: 'Grand Opening' }] },
  weekday: { enabled: true, rules: [{ day: 2, categoryId: 'pedi', percent: 30 }], startDate: '2026-11-01', endDate: '2026-11-30' },
  group: { enabled: true, tiers: [{ minSize: 2, percent: 10 }, { minSize: 3, percent: 25 }], endDate: '2026-10-10' },
};

describe('the deal on a day', () => {
  it('Grand Opening applies to every service on its days, with its name', () => {
    expect(promoDeal(grandOpening, d(2026, 10, 2), 'mani')).toEqual({ pct: 20, source: 'date', label: 'Grand Opening' });
    expect(promoDeal(grandOpening, d(2026, 10, 26), 'mani').pct).toBe(0);
  });
  it('a weekday program only runs between its dates', () => {
    expect(promoDeal(grandOpening, d(2026, 11, 3), 'pedi').pct).toBe(30); // Tuesday in November
    expect(promoDeal(grandOpening, d(2026, 12, 1), 'pedi').pct).toBe(0);  // Tuesday in December
    expect(promoDeal(grandOpening, d(2026, 11, 3), 'mani').pct).toBe(0);  // other category
  });
  it('group tier wins only when it is bigger, and only inside its dates', () => {
    expect(lineDeal(grandOpening, d(2026, 10, 5), 'mani', 3)).toMatchObject({ pct: 25, source: 'group' });
    expect(lineDeal(grandOpening, d(2026, 10, 5), 'mani', 2)).toMatchObject({ pct: 20, source: 'date' });
    expect(groupPct(grandOpening.group, 3, d(2026, 10, 11))).toBe(0);
  });
  it('the calendar strip marks any day with a deal', () => {
    expect(anyDealPct(grandOpening, d(2026, 11, 3))).toBe(30);
    expect(anyDealPct(grandOpening, d(2026, 11, 4))).toBe(0);
  });
  it('programs saved before run dates existed behave as before', () => {
    const old: Promos = { weekday: { enabled: true, rules: [{ day: 2, categoryId: null, percent: 10 }] } };
    expect(promoDeal(old, d(2031, 1, 7), 'x').pct).toBe(10);
    expect(inWindow(undefined, '2031-01-07')).toBe(true);
  });
});

describe('what the menu advertises before a day is picked', () => {
  it('the soonest best deal ahead', () => {
    const n = nextDeal(grandOpening, d(2026, 10, 28), 14, 'pedi');
    expect(n?.pct).toBe(30);
    expect(n?.date.getDate()).toBe(3); // Tue Nov 3
  });
  it('nothing ahead → nothing', () => {
    expect(nextDeal(grandOpening, d(2027, 1, 1), 30, 'pedi')).toBeNull();
  });
  it('an ended program is ended', () => {
    expect(windowEnded({ endDate: '2026-10-25' }, '2026-10-26')).toBe(true);
    expect(windowEnded({ endDate: '2026-10-25' }, '2026-10-25')).toBe(false);
    expect(windowEnded({}, '2030-01-01')).toBe(false);
  });
  it('price after the deal', () => {
    expect(afterPct(2700, 20)).toBe(2160);
  });
});
