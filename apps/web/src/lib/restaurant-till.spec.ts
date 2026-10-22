import {
  addToCart, bankName, byTableName, callText, cartKey, cartToOrder, cartTotal, cashQuickAmounts, combinedState, evenShares, formatMoney, isTableIndustry, lineGroups, minutesOpen,
  optionsReady, pendingLines, priceWith, tableState, ticketTone, tillError, timerTone, vietQr, type CheckLine,
} from './restaurant-till';
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

  describe('phase 3', () => {
    it('a guest waiting on staff paints the table first', () => {
      expect(tableState({ status: 'OPEN', itemCount: 0, unsentCount: 0, preBilledAt: null, pendingCount: 2 })).toBe('call');
      expect(tableState({ status: 'OPEN', itemCount: 3, unsentCount: 1, preBilledAt: null, callReason: 'water' })).toBe('call');
      expect(tableState({ status: 'PAYING', itemCount: 3, unsentCount: 0, preBilledAt: null, callReason: 'bill' })).toBe('paying');
      expect(combinedState([{ status: 'OPEN', itemCount: 2, unsentCount: 2, preBilledAt: null }, { status: 'OPEN', itemCount: 0, unsentCount: 0, preBilledAt: null, pendingCount: 1 }])).toBe('call');
    });

    it('keeps the guests\' QR dishes out of the bill rounds', () => {
      const lines = [L('a', { state: 'SENT', batch: 1 }), L('b', { state: 'PENDING', source: 'QR' }), L('c', { held: true })];
      const g = lineGroups(lines);
      expect(g.map((x) => x.key)).toEqual(['b1', 'unsent']);
      expect(g.flatMap((x) => x.lines.map((l) => l.id))).toEqual(['a', 'c']);
      expect(pendingLines(lines).map((l) => l.id)).toEqual(['b']);
    });

    it('says what the guest asked for', () => {
      expect(callText('bill', true)).toBe('Khách xin thanh toán');
      expect(callText('staff', false)).toBe('Guest is calling');
      expect(callText('nonsense', true)).toBe('Khách gọi nhân viên');
    });

    it('makes a VietQR for exactly what is owed, in đồng only', () => {
      const bank = { bin: '970436', accountNo: '0123456789', accountName: 'NHA HANG LUMIO' };
      const u = vietQr(bank, 255000, 'LM57', 'VND')!;
      expect(u.startsWith('https://img.vietqr.io/image/970436-0123456789-compact2.png?')).toBe(true);
      expect(u).toContain('amount=255000');
      expect(u).toContain('addInfo=LM57');
      expect(vietQr(bank, 2500, 'LM57', 'USD')).toBeNull();
      expect(vietQr(null, 1, 'LM1', 'VND')).toBeNull();
      expect(vietQr({ bin: '97', accountNo: '01', accountName: '' }, 1, 'LM1', 'VND')).toBeNull();
      expect(bankName('Nhà hàng Đông Á')).toBe('NHA HANG DONG A');
    });

    it('formats money the way the restaurant counts it', () => {
      expect(formatMoney(255000, 'VND').replace(/\s/g, ' ')).toMatch(/255\.000/);
      expect(formatMoney(1250, 'USD')).toBe('$12.50');
    });

    it('ages a kitchen ticket', () => {
      const now = new Date('2026-10-22T12:20:00Z');
      expect(ticketTone('2026-10-22T12:15:00Z', now)).toEqual({ mins: 5, tone: 'ok' });
      expect(ticketTone('2026-10-22T12:09:00Z', now)).toEqual({ mins: 11, tone: 'warn' });
      expect(ticketTone('2026-10-22T12:00:00Z', now)).toEqual({ mins: 20, tone: 'late' });
      expect(ticketTone(null, now).mins).toBe(0);
    });

    it('keeps the guest cart tidy and sends only ids', () => {
      const base = { menuItemId: 'm1', name: 'Phở', unitPriceCents: 85000, quantity: 1, optionNames: [], note: '' };
      let cart = addToCart([], { ...base, options: [{ groupId: 'g', choiceIds: ['b', 'a'] }] });
      cart = addToCart(cart, { ...base, options: [{ groupId: 'g', choiceIds: ['a', 'b'] }] });
      cart = addToCart(cart, { ...base, options: [], note: 'Không hành' });
      expect(cart).toHaveLength(2);
      expect(cart[0].quantity).toBe(2);
      expect(cartTotal(cart)).toEqual({ count: 3, cents: 255000 });
      expect(cartKey('m1', [{ groupId: 'g', choiceIds: [] }])).toBe(cartKey('m1', []));
      const order = cartToOrder(cart);
      expect(order[1]).toEqual({ menuItemId: 'm1', quantity: 1, options: [], note: 'Không hành' });
      expect(JSON.stringify(order)).not.toContain('85000');
      expect(addToCart([], { ...base, quantity: 50, options: [] })[0].quantity).toBe(20);
    });

    it('explains the new refusals', () => {
      expect(tillError('QR_PENDING', true)).toContain('QR');
      expect(tillError('QR_OFF', false)).toBe('QR ordering is turned off.');
    });
  });
});
