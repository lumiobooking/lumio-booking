import {
  checkLabel, chosenOf, cleanOptionGroups, dayIn, optionsKey, pickOptions, soldOutNow,
  DEFAULT_SETTINGS, checkTotals, cleanNote, cleanSettings, groupForSend, langFor, moneyText, prebillText, qty, stationFor,
  stationsCooking, tablesLabel, ticketText, LineLike,
} from './check-logic';

const line = (id: string, over: Partial<LineLike> = {}): LineLike => ({ id, name: 'Phở bò', unitPriceCents: 85000, quantity: 1, station: 'KITCHEN', state: 'UNSENT', ...over });

describe('restaurant settings', () => {
  it('falls back to kitchen + bar and sane timers', () => {
    const s = cleanSettings(null);
    expect(s.stations.map((x) => x.key)).toEqual(['KITCHEN', 'BAR']);
    expect(s.defaultStation).toBe('KITCHEN');
    expect(s.voidNeedsApproval).toBe(true);
    expect(s.warnMinutes).toBe(60);
    expect(s.lateMinutes).toBe(90);
  });

  it('keeps only valid stations, drops mappings to unknown stations, normalises categories', () => {
    const s = cleanSettings({
      stations: [{ key: 'grill', name: 'Bếp nướng' }, { key: 'GRILL', name: 'dup' }, { key: 'x', name: 'too short' }, { key: 'BAR', name: 'Bar' }],
      byCategory: { '  Đồ  Uống ': 'bar', 'Nướng': 'GRILL', 'Lẩu': 'KITCHEN' },
      defaultStation: 'nope', warnMinutes: 1, lateMinutes: 2, printVoid: 'yes',
    });
    expect(s.stations).toEqual([{ key: 'GRILL', name: 'Bếp nướng' }, { key: 'BAR', name: 'Bar' }]);
    expect(s.byCategory).toEqual({ 'đồ uống': 'BAR', 'nướng': 'GRILL' });
    expect(s.defaultStation).toBe('GRILL');
    expect(s.warnMinutes).toBe(60);
    expect(s.lateMinutes).toBeGreaterThan(s.warnMinutes);
    expect(s.printVoid).toBe(true);
  });
});

describe('which station makes a dish', () => {
  it('owner mapping first, then drinks to the bar, then the default', () => {
    const s = cleanSettings({ ...DEFAULT_SETTINGS, byCategory: { 'Tráng miệng': 'BAR' } });
    expect(stationFor('tráng miệng', s)).toBe('BAR');
    expect(stationFor('Đồ uống', s)).toBe('BAR');
    expect(stationFor('Beer & Wine', s)).toBe('BAR');
    expect(stationFor('Phở', s)).toBe('KITCHEN');
    expect(stationFor(null, s)).toBe('KITCHEN');
  });
  it('no bar station → drinks go to the default', () => {
    const s = cleanSettings({ stations: [{ key: 'KITCHEN', name: 'Bếp' }] });
    expect(stationFor('Đồ uống', s)).toBe('KITCHEN');
  });
});

describe('bill totals', () => {
  it('counts every line not taken back, and what is still unsent', () => {
    const t = checkTotals([
      line('a', { quantity: 2, state: 'SENT' }),
      line('b', { unitPriceCents: 30000, quantity: 2 }),
      line('c', { unitPriceCents: 55000, state: 'VOID' }),
    ]);
    expect(t.subtotalCents).toBe(230000);
    expect(t.itemCount).toBe(4);
    expect(t.unsentCount).toBe(2);
    expect(t.sentCount).toBe(2);
    expect(t.voidedCents).toBe(55000);
  });
});

describe('send to kitchen', () => {
  const s = cleanSettings(null);
  it('sends only unsent lines, grouped by station in station order', () => {
    const g = groupForSend([
      line('beer', { station: 'BAR' }),
      line('sent', { state: 'SENT' }),
      line('pho'),
      line('void', { state: 'VOID' }),
    ], s);
    expect(g.map((x) => x.station)).toEqual(['KITCHEN', 'BAR']);
    expect(g[0].lines.map((l) => l.id)).toEqual(['pho']);
    expect(g[1].lines.map((l) => l.id)).toEqual(['beer']);
  });
  it('nothing new → nothing to print (pressing twice prints once)', () => {
    expect(groupForSend([line('a', { state: 'SENT' })], s)).toEqual([]);
  });
  it('a moved table only tells stations still cooking', () => {
    expect(stationsCooking([line('a', { state: 'SENT' }), line('b', { station: 'BAR' }), line('c', { station: 'BAR', state: 'VOID' })])).toEqual(['KITCHEN']);
  });
});

describe('input cleaning', () => {
  it('quantity is whole 1–99', () => {
    expect(qty('3')).toBe(3);
    expect(qty(0)).toBeNull();
    expect(qty(0, 0)).toBe(0);
    expect(qty(100)).toBeNull();
    expect(qty('x')).toBeNull();
  });
  it('notes are one short line', () => {
    expect(cleanNote('  ít   hành\n không giá ')).toBe('ít hành không giá');
    expect(cleanNote('')).toBeNull();
    expect((cleanNote('x'.repeat(500)) ?? '').length).toBe(140);
  });
});

describe('printed tickets', () => {
  it('kitchen ticket: station, big table, send number, quantities, notes', () => {
    const t = ticketText({ kind: 'NEW', lang: 'vi', stationName: 'Bếp', tables: 'A3', checkNumber: 57, batch: 3, guests: 4, server: 'Lan', at: '22/10 19:24', lines: [{ quantity: 2, name: 'Phở bò tái nạm', note: 'Ít hành' }] });
    expect(t).toContain('BẾP · MÓN MỚI');
    expect(t).toContain('BÀN A3');
    expect(t).toContain('Bill bàn #57 · Lần gửi 3');
    expect(t).toContain('2 x Phở bò tái nạm');
    expect(t).toContain('- Ít hành');
    for (const row of t.split('\n')) expect(row.length).toBeLessThanOrEqual(32);
  });
  it('cancel ticket carries the reason and who approved', () => {
    const t = ticketText({ kind: 'VOID', lang: 'en', stationName: 'Kitchen', tables: 'T4', checkNumber: 9, at: '10/22 7:31 PM', reason: 'Guest changed mind', by: 'Phong', approver: 'Quan', lines: [{ quantity: 1, name: 'Pho', sentAt: '7:02 PM' }] });
    expect(t).toContain('*** CANCEL ***');
    expect(t).toContain('Reason: Guest changed mind');
    expect(t).toContain('Approved: Quan');
  });
  it('move ticket names both tables', () => {
    const t = ticketText({ kind: 'MOVE', lang: 'vi', stationName: 'Bar', tables: 'S3', fromTables: 'A3', checkNumber: 5, at: 'x', lines: [{ quantity: 2, name: 'Bia' }] });
    expect(t).toContain('A3 -> S3');
  });
  it('guest check says it is not a receipt, with the total', () => {
    const p = prebillText({ lang: 'vi', business: 'Phở Lumio', tables: 'A3', checkNumber: 57, count: 1, at: '22/10 19:45', lines: [{ quantity: 2, name: 'Bia Saigon', amountCents: 60000 }], totalCents: 60000, money: (c) => moneyText(c, 'VND') });
    expect(p).toContain('PHIẾU TẠM TÍNH');
    expect(p).toContain('CHƯA PHẢI HOÁ ĐƠN');
    expect(p).toMatch(/TỔNG\s+60\.000 đ/);
  });
});

describe('formats', () => {
  it('money in the restaurant currency', () => {
    expect(moneyText(415000, 'VND')).toBe('415.000 đ');
    expect(moneyText(1250, 'USD')).toBe('$12.50');
    expect(langFor('VND')).toBe('vi');
    expect(langFor('USD')).toBe('en');
  });
  it('tables label for a bill on joined tables', () => {
    expect(tablesLabel(['a', 'b'], new Map([['a', 'A7'], ['b', 'A8']]))).toBe('A7 + A8');
  });
});

describe('dish options', () => {
  const groups = cleanOptionGroups([
    { id: 'size', name: 'Cỡ tô', required: true, max: 1, choices: [{ id: 'n', name: 'Thường' }, { id: 'l', name: 'Lớn', priceCents: 15000 }] },
    { id: 'add', name: 'Thêm', max: 3, choices: [{ id: 'egg', name: 'Trứng', priceCents: 10000 }, { id: 'q', name: 'Quẩy', priceCents: -5 }] },
    { name: '', choices: [{ name: 'x' }] },
    { name: 'Empty', choices: [] },
  ]);
  it('keeps named groups with named choices, never a negative price', () => {
    expect(groups.map((g) => g.id)).toEqual(['size', 'add']);
    expect(groups[1].choices[1].priceCents).toBe(0);
    expect(groups[1].max).toBe(2);
  });
  it('prices the picks and refuses a missing required group, too many, or an invented choice', () => {
    const p = pickOptions(groups, [{ groupId: 'size', choiceIds: ['l'] }, { groupId: 'add', choiceIds: ['egg'] }]);
    expect(p.extraCents).toBe(25000);
    expect(p.chosen.map((c) => c.name)).toEqual(['Lớn', 'Trứng']);
    expect(() => pickOptions(groups, [])).toThrow('OPTION_REQUIRED:Cỡ tô');
    expect(() => pickOptions(groups, [{ groupId: 'size', choiceIds: ['n', 'l'] }])).toThrow('OPTION_TOO_MANY');
    expect(() => pickOptions(groups, [{ groupId: 'size', choiceIds: ['zz'] }])).toThrow('OPTION_UNKNOWN');
    expect(() => pickOptions(groups, [{ groupId: 'other', choiceIds: ['n'] }])).toThrow('OPTION_UNKNOWN');
    expect(pickOptions([], undefined)).toEqual({ chosen: [], extraCents: 0 });
  });
  it('reads stored options back safely and keys them for merging lines', () => {
    expect(chosenOf([{ group: 'A', name: 'B', priceCents: '5' }, null, { name: '' }])).toEqual([{ group: 'A', name: 'B', priceCents: 5 }]);
    expect(optionsKey([{ group: 'A', name: 'B', priceCents: 0 }])).toBe('A:B');
  });
  it('prints options on the kitchen ticket', () => {
    const t = ticketText({ kind: 'NEW', lang: 'vi', stationName: 'Bếp', tables: 'A1', checkNumber: 1, at: 'x', lines: [{ quantity: 1, name: 'Phở', options: ['Lớn', 'Trứng'] }] });
    expect(t).toContain('+ Lớn');
    expect(t).toContain('+ Trứng');
  });
});

describe('sold out, to-go bills, cashiers', () => {
  it('a dish sold out yesterday is back today when the daily reset is on', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    const now = new Date('2026-10-22T05:00:00Z'); // 12:00 in Saigon
    expect(soldOutNow(new Date('2026-10-22T01:00:00Z'), true, tz, now)).toBe(true);
    expect(soldOutNow(new Date('2026-10-21T17:30:00Z'), true, tz, now)).toBe(true); // 00:30 on the 22nd in Saigon
    expect(soldOutNow(new Date('2026-10-21T10:00:00Z'), true, tz, now)).toBe(false);
    expect(soldOutNow(new Date('2026-10-01T10:00:00Z'), false, tz, now)).toBe(true);
    expect(soldOutNow(null, true, tz, now)).toBe(false);
    expect(dayIn(now, tz)).toBe('2026-10-22');
  });
  it('a to-go bill is named by its number', () => {
    expect(checkLabel([], new Map(), 12, 'vi')).toBe('Mang về #12');
    expect(checkLabel([], new Map(), 12, 'en')).toBe('To go #12');
    expect(checkLabel(['a'], new Map([['a', 'A1']]), 12, 'vi')).toBe('A1');
    expect(ticketText({ kind: 'NEW', lang: 'vi', stationName: 'Bếp', tables: 'Mang về #12', takeaway: true, checkNumber: 12, at: 'x', lines: [] })).toContain('MANG VỀ #12');
  });
  it('cashier list keeps only plausible user ids', () => {
    const s = cleanSettings({ cashierUserIds: ['3f2a9c1e-1111-2222-3333-444455556666', 'x', 42, '3f2a9c1e-1111-2222-3333-444455556666'] });
    expect(s.cashierUserIds).toEqual(['3f2a9c1e-1111-2222-3333-444455556666']);
    expect(s.soldOutReset).toBe(true);
  });
});
