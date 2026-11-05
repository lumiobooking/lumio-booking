import { guestProgress, menuSections, quickQty, tintFor } from './guest-order';
import { floorStats, mapBox, qtyByDish, spotTop } from './till-floor';

/** Nov 2026 redesign of the guest QR page and the till floor (mockup "Sơ đồ bàn & Đặt món"). */
describe('guest QR ordering', () => {
  const line = (menuItemId: string, quantity: number, extra: Record<string, unknown> = {}) => ({ key: `${menuItemId}${JSON.stringify(extra)}`, menuItemId, name: menuItemId, unitPriceCents: 100, quantity, options: [], optionNames: [], note: '', ...extra });
  it('the row stepper counts only the plain dish (not one with options or a note)', () => {
    const cart = [line('pho', 2), line('pho', 1, { note: 'ít hành' }), line('pho', 1, { options: [{ groupId: 'g', choiceIds: ['big'] }] }), line('tea', 3)];
    expect(quickQty(cart as never, 'pho')).toBe(2);
    expect(quickQty(cart as never, 'coffee')).toBe(0);
  });
  it('one section per category when showing everything; one list when filtered or a single category', () => {
    const items = [{ id: 1, category: 'Phở' }, { id: 2, category: 'Bún' }, { id: 3, category: null }, { id: 4, category: 'Phở' }];
    expect(menuSections(items, true, 'Khác').map((s) => [s.title, s.items.length])).toEqual([['Phở', 2], ['Bún', 1], ['Khác', 1]]);
    expect(menuSections(items, false, 'Khác')).toEqual([{ title: '', items }]);
    expect(menuSections([{ category: 'Phở' }], true, 'Khác')).toEqual([{ title: '', items: [{ category: 'Phở' }] }]);
    expect(menuSections([], true, 'Khác')).toEqual([]);
  });
  it('kitchen progress: waiting → received → cooking → served', () => {
    expect(['waiting', 'ordered', 'cooking', 'ready'].map((s) => guestProgress(s as never).step)).toEqual([0, 1, 2, 3]);
  });
  it('a dish without a photo always gets the same tint', () => {
    expect(tintFor('Phở bò tái')).toEqual(tintFor('Phở bò tái'));
  });
});

describe('till floor', () => {
  it('counts tables with guests (a merged bill counts each table), open bills, to-go, money and what needs someone', () => {
    const st = floorStats(12, [
      { tableIds: ['a', 'b'], guests: 6, subtotalCents: 50000, unsentCount: 0 },
      { tableIds: ['c'], guests: 2, subtotalCents: 20000, unsentCount: 1 },
      { tableIds: [], guests: 1, subtotalCents: 9000, unsentCount: 0, payRequestedAt: '2026-11-05T10:00:00Z' },
    ]);
    expect(st).toEqual({ tables: 12, busyTables: 3, guests: 8, openBills: 3, takeaway: 1, openCents: 79000, attention: 2 });
  });
  it('rows 140 px apart from the first row; the box is as tall as the lowest table needs', () => {
    expect(spotTop(6)).toBe(0);
    expect(spotTop(24)).toBe(140);
    expect(mapBox([{ x: 4, y: 6, shape: 'round' }]).height).toBe(420);
    expect(mapBox([{ x: 4, y: 78, shape: 'round' }]).height).toBe(560 + 140);
  });
  it('the dish card badge: how many the bill already has, voided aside', () => {
    const m = qtyByDish([{ menuItemId: 'pho', quantity: 2, state: 'SENT' }, { menuItemId: 'pho', quantity: 1, state: 'UNSENT' }, { menuItemId: 'pho', quantity: 5, state: 'VOID' }, { menuItemId: null, quantity: 1, state: 'SENT' }]);
    expect(m.get('pho')).toBe(3);
    expect(m.size).toBe(1);
  });
});
