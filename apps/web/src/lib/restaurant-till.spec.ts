import { byTableName, cashQuickAmounts, combinedState, evenShares, isTableIndustry, lineGroups, minutesOpen, optionsReady, priceWith, tableState, tillError, timerTone, type CheckLine } from './restaurant-till';
import { countTotal, denominationsFor } from './cash-count';

const L = (id: string, over: Partial<CheckLine> = {}): CheckLine => ({ id, menuItemId: 'm', name: 'Phở', unitPriceCents: 85000, quantity: 1, note: null, station: 'KITCHEN', state: 'UNSENT', batch: null, sentAt: null, sentByName: null, voidReason: null, ...over });

describe('restaurant till', () => {
  it('only restaurants, quán ăn and cafés get the table till', () => {
    expect(isTableIndustry('RESTAURANT')).toBe(true);
    expect(isTableIndustry('CAFE')).toBe(true);
    expect(isTableIndustry('FAST_FOOD')).toBe(true);
    expect(isTableIndustry('NAIL')).toBe(false);
    expect(isTableIndustry(null)).toBe(false);
  });

  it('paints a table by what the server must do next', () => {
    expect(tableState(null)).toBe('free');
    expect(tableState({ status: 'OPEN', itemCount: 0, unsentCount: 0, preBilledAt: null })).toBe('seated');
    expect(tableState({ status: 'OPEN', itemCount: 3, unsentCount: 0, preBilledAt: null })).toBe('ordered');
    expect(tableState({ status: 'OPEN', itemCount: 3, unsentCount: 1, preBilledAt: '2026-10-22T12:00:00Z' })).toBe('unsent');
    expect(tableState({ status: 'OPEN', itemCount: 3, unsentCount: 0, preBilledAt: '2026-10-22T12:00:00Z' })).toBe('prebilled');
    expect(tableState({ status: 'PAYING', itemCount: 3, unsentCount: 0, preBilledAt: null })).toBe('paying');
  });

  it('times a table and turns it yellow then red', () => {
    const now = new Date('2026-10-22T12:47:30Z');
    expect(minutesOpen('2026-10-22T12:00:00Z', now)).toBe(47);
    expect(minutesOpen('2026-10-22T13:00:00Z', now)).toBe(0);
    expect(minutesOpen('junk', now)).toBe(0);
    expect(timerTone(47)).toBe('ok');
    expect(timerTone(60)).toBe('warn');
    expect(timerTone(95)).toBe('late');
    expect(timerTone(30, 20, 25)).toBe('late');
  });

  it('groups the bill: sent rounds oldest first, then the unsent lines last', () => {
    const g = lineGroups([
      L('new'),
      L('r2', { state: 'SENT', batch: 2, sentAt: 't2', sentByName: 'Phong' }),
      L('r1', { state: 'SENT', batch: 1, sentAt: 't1', sentByName: 'Lan' }),
      L('r1v', { state: 'VOID', batch: 1, sentAt: 't1', sentByName: 'Lan' }),
    ]);
    expect(g.map((x) => x.key)).toEqual(['b1', 'b2', 'unsent']);
    expect(g[0].by).toBe('Lan');
    expect(g[0].lines.map((l) => l.id)).toEqual(['r1', 'r1v']);
  });

  it('explains refusals in words', () => {
    expect(tillError('TABLE_BUSY:abc', true)).toContain('đang có bill');
    expect(tillError('UNSENT_LINES', false)).toContain('not been sent');
    expect(tillError('APPROVAL_PIN_REQUIRED: cần PIN', true)).toContain('PIN');
    expect(tillError('', true)).toBe('Có lỗi, thử lại.');
  });

  it('suggests cash notes: exact first, then round notes up', () => {
    expect(cashQuickAmounts(415000, 'VND')).toEqual([415000, 420000, 450000, 500000, 600000]);
    expect(cashQuickAmounts(1250, 'USD')).toEqual([1250, 1300, 1500, 2000, 5000]);
  });

  it('a table that asked to pay stands out, and a split table shows its most urgent bill', () => {
    expect(tableState({ status: 'OPEN', itemCount: 2, unsentCount: 0, preBilledAt: 'x', payRequestedAt: 'y' })).toBe('askpay');
    expect(combinedState([
      { status: 'OPEN', itemCount: 2, unsentCount: 0, preBilledAt: null },
      { status: 'OPEN', itemCount: 1, unsentCount: 1, preBilledAt: null },
    ])).toBe('unsent');
    expect(combinedState([])).toBe('free');
  });

  it('lists tables the way people count them', () => {
    const names = ['M10', 'M2', 'M1', 'B3', 'm9'].map((name) => ({ name })).sort(byTableName).map((t) => t.name);
    expect(names).toEqual(['B3', 'M1', 'M2', 'm9', 'M10']);
  });

  it('dish options: required groups block, extras add up', () => {
    const groups = [
      { id: 's', name: 'Size', required: true, max: 1, choices: [{ id: 'n', name: 'N', priceCents: 0 }, { id: 'l', name: 'L', priceCents: 15000 }] },
      { id: 'a', name: 'Add', required: false, max: 2, choices: [{ id: 'e', name: 'Egg', priceCents: 10000 }, { id: 'q', name: 'Q', priceCents: 5000 }] },
    ];
    expect(optionsReady(groups, {})).toBe(false);
    expect(optionsReady(groups, { s: ['l'] })).toBe(true);
    expect(optionsReady(groups, { s: ['l', 'n'] })).toBe(false);
    expect(priceWith(85000, groups, { s: ['l'], a: ['e', 'q'] })).toBe(115000);
  });

  it('splits a total evenly to the last đồng', () => {
    expect(evenShares(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(evenShares(100000, 3).reduce((a, b) => a + b, 0)).toBe(100000);
    expect(evenShares(500, 0)).toEqual([500]);
  });

  it('server codes and English validation become Vietnamese', () => {
    expect(tillError('SOLD_OUT', true)).toBe('Món này đã hết.');
    expect(tillError('OPTION_REQUIRED:Cỡ tô', true)).toBe('Chọn “Cỡ tô” trước.');
    expect(tillError('CHECK_NOT_FOUND', true)).toContain('Không tìm thấy bill');
    expect(tillError('guests must not be greater than 99', true)).toBe('Dữ liệu không hợp lệ, thử lại.');
    expect(tillError('Tendered amount is less than the amount due', true)).toBe('Số tiền khách đưa ít hơn số phải thu.');
    expect(tillError('guests must not be greater than 99', false)).toBe('guests must not be greater than 99');
  });

  it('counts the drawer note by note in the restaurant currency', () => {
    expect(denominationsFor('VND')[0]).toBe(500000);
    expect(denominationsFor('xyz')).toEqual(denominationsFor('USD'));
    expect(countTotal({ 500000: 12, 200000: 10, 100000: 15, 50000: 8, 20000: 5, 10000: 4, 5000: 2 })).toBe(10_050_000);
  });
});
