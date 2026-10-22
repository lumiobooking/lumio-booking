import { cashQuickAmounts, isTableIndustry, lineGroups, minutesOpen, tableState, tillError, timerTone, type CheckLine } from './restaurant-till';

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
});
