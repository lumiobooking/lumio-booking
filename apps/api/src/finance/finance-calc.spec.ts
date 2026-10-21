import {
  advanceDue, assembleLedger, buildPnl, drawerLines, dueDaysUpTo, entryLines, payrollFigures, refundLines, salesLines, shiftDiffLines, voucherCode,
  type FundRow, type LedgerLine,
} from './finance-calc';

/**
 * Thu & Chi arithmetic. Every number on the cash book and the P&L comes out
 * of these functions; the service only loads the rows they are fed.
 */

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00.000Z`);
const CASH = 'f-cash', BANK = 'f-bank';
const funds: FundRow[] = [
  { id: CASH, kind: 'CASH', name: 'Cash', openingCents: 10_000, openingDate: '2026-10-01', isDefault: false, archived: false },
  { id: BANK, kind: 'BANK', name: 'Bank', openingCents: 50_000, openingDate: '2026-10-01', isDefault: true, archived: false },
];
const line = (p: Partial<LedgerLine> & { id: string; day: string; fundId: string; direction: 'IN' | 'OUT'; amountCents: number }): LedgerLine => ({
  at: at(p.day).toISOString(), source: 'MANUAL', categoryId: null, countsInPl: true, label: '', locked: false, ...p,
});

describe('sales lines', () => {
  it('one line per day per fund; cash in the drawer, everything else in the bank', () => {
    const rows = [
      { id: 'p1', amountCents: 3000, provider: 'pos-cash', status: 'PAID', paidAt: at('2026-10-05', 15), providerReference: 'order:o1' },
      { id: 'p2', amountCents: 2000, provider: 'pos-cash', status: 'PAID', paidAt: at('2026-10-05', 16), providerReference: 'order:o2' },
      { id: 'p3', amountCents: 4500, provider: 'pos-card', status: 'PAID', paidAt: at('2026-10-05', 17), providerReference: 'order:o3' },
      { id: 'p4', amountCents: 1000, provider: 'stripe', status: 'PAID', paidAt: at('2026-10-06'), providerReference: 'pi_123' },
    ];
    const out = salesLines(rows, dayOf, CASH, BANK, new Set());
    const cash = out.find((l) => l.id === `sales:2026-10-05:${CASH}`)!;
    const bank = out.find((l) => l.id === `sales:2026-10-05:${BANK}`)!;
    expect(cash.amountCents).toBe(5000);
    expect(cash.ref).toEqual({ kind: 'salesDay', id: `2026-10-05|${CASH}`, count: 2 });
    expect(bank.amountCents).toBe(4500);
    expect(out.find((l) => l.day === '2026-10-06')!.fundId).toBe(BANK);
    expect(out.every((l) => !l.countsInPl)).toBe(true);
  });

  it('a part refund is money out on its own day', () => {
    const out = salesLines([{ id: 'r1', amountCents: -700, provider: 'pos-cash', status: 'PAID', paidAt: at('2026-10-07'), providerReference: 'order:o1' }], dayOf, CASH, BANK, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ direction: 'OUT', amountCents: 700, source: 'REFUND', fundId: CASH, day: '2026-10-07' });
  });

  it('a fully refunded bill still brought its money in; a voided one never did', () => {
    const rows = [
      { id: 'a', amountCents: 5000, provider: 'pos-card', status: 'REFUNDED', paidAt: at('2026-10-05'), providerReference: 'order:refunded' },
      { id: 'b', amountCents: 9000, provider: 'pos-card', status: 'REFUNDED', paidAt: at('2026-10-05'), providerReference: 'order:voided' },
      { id: 'c', amountCents: 9000, provider: 'stripe', status: 'REFUNDED', paidAt: at('2026-10-05'), providerReference: 'pi_x' },
      { id: 'd', amountCents: 800, provider: 'pos-card', status: 'PENDING', paidAt: at('2026-10-05'), providerReference: 'order:z' },
    ];
    const out = salesLines(rows, dayOf, CASH, BANK, new Set(['refunded']));
    expect(out).toHaveLength(1);
    expect(out[0].amountCents).toBe(5000);
  });
});

describe('refund, drawer and shift lines', () => {
  it('a whole-bill refund leaves the fund it was paid back from', () => {
    const out = refundLines([
      { id: 'x', orderId: 'o1', orderNumber: '1042', amountCents: 5000, method: 'CASH', reason: 'bong', createdAt: at('2026-10-08') },
      { id: 'y', orderId: 'o2', amountCents: 3000, method: 'CARD', reason: null, createdAt: at('2026-10-08') },
    ], dayOf, CASH, BANK);
    expect(out.map((l) => [l.fundId, l.direction, l.amountCents])).toEqual([[CASH, 'OUT', 5000], [BANK, 'OUT', 3000]]);
    expect(out[0].label).toContain('1042');
  });

  it('refund-made drawer movements are not counted twice; unclassified money out counts as cost, in does not', () => {
    const catPl = (id: string) => (id === 'cat-tips' ? { countsInPl: false, systemKey: 'tips_out' } : id === 'cat-laundry' ? { countsInPl: true, systemKey: 'laundry' } : null);
    const out = drawerLines([
      { id: 'm1', shiftId: 's', kind: 'OUT', amountCents: 5000, reason: 'Hoàn tiền bill #1042', byName: null, createdAt: at('2026-10-08'), categoryId: null, source: null },
      { id: 'm2', shiftId: 's', kind: 'OUT', amountCents: 5000, reason: 'x', byName: null, createdAt: at('2026-10-08'), categoryId: null, source: 'refund' },
      { id: 'm3', shiftId: 's', kind: 'OUT', amountCents: 1800, reason: 'đá', byName: 'Linh', createdAt: at('2026-10-08'), categoryId: null, source: null },
      { id: 'm4', shiftId: 's', kind: 'IN', amountCents: 2000, reason: 'thêm tiền lẻ', byName: 'Linh', createdAt: at('2026-10-08'), categoryId: null, source: null },
      { id: 'm5', shiftId: 's', kind: 'OUT', amountCents: 6000, reason: 'tip', byName: 'Linh', createdAt: at('2026-10-08'), categoryId: 'cat-tips', source: null },
      { id: 'm6', shiftId: 's', kind: 'OUT', amountCents: 900, reason: 'giặt', byName: 'Linh', createdAt: at('2026-10-08'), categoryId: 'cat-laundry', source: null },
    ], dayOf, CASH, BANK, catPl);
    expect(out.map((l) => l.id)).toEqual(['mv:m3', 'mv:m4', 'mv:m5', 'mv:m6']);
    expect(out.find((l) => l.id === 'mv:m3')).toMatchObject({ countsInPl: true, needsReview: true, categoryId: null });
    expect(out.find((l) => l.id === 'mv:m4')).toMatchObject({ countsInPl: false, needsReview: true });
    expect(out.find((l) => l.id === 'mv:m5')).toMatchObject({ countsInPl: false, needsReview: false, categoryId: 'cat-tips' });
    expect(out.find((l) => l.id === 'mv:m6')).toMatchObject({ countsInPl: true, categoryId: 'cat-laundry' });
  });

  it('cash taken to the bank from the drawer is a transfer: out of the drawer, into the bank, never a cost', () => {
    const out = drawerLines([
      { id: 'b1', shiftId: 's', kind: 'OUT', amountCents: 40_000, reason: 'nộp NH', byName: 'Mai', createdAt: at('2026-10-08'), categoryId: 'dep', source: null },
    ], dayOf, CASH, BANK, (id) => (id === 'dep' ? { countsInPl: false, systemKey: 'bank_deposit' } : null));
    expect(out.map((l) => [l.fundId, l.direction, l.amountCents, l.source, l.countsInPl])).toEqual([[CASH, 'OUT', 40_000, 'TRANSFER', false], [BANK, 'IN', 40_000, 'TRANSFER', false]]);
    const r = assembleLedger(funds, out, '2026-10-01', '2026-10-31', null);
    expect([r.inCents, r.outCents, r.transferCents]).toEqual([0, 0, 40_000]);
  });

  it('a shift that counted short is cash out on the P&L; over is cash in', () => {
    const out = shiftDiffLines([
      { id: 's1', closedAt: at('2026-10-09', 22), varianceCents: -1200, closedByName: 'Mai' },
      { id: 's2', closedAt: at('2026-10-10', 22), varianceCents: 300, closedByName: 'Mai' },
      { id: 's3', closedAt: at('2026-10-11', 22), varianceCents: 0, closedByName: 'Mai' },
    ], dayOf, CASH);
    expect(out.map((l) => [l.direction, l.amountCents, l.countsInPl])).toEqual([['OUT', 1200, true], ['IN', 300, true]]);
  });
});

describe('the cash book', () => {
  const base: LedgerLine[] = [
    line({ id: 'a', day: '2026-09-20', fundId: CASH, direction: 'IN', amountCents: 99_999 }), // before the books start
    line({ id: 'b', day: '2026-10-02', fundId: CASH, direction: 'IN', amountCents: 5_000 }),
    line({ id: 'c', day: '2026-10-03', fundId: BANK, direction: 'OUT', amountCents: 20_000 }),
    line({ id: 'd', day: '2026-10-10', fundId: CASH, direction: 'IN', amountCents: 3_000 }),
    line({ id: 'e', day: '2026-10-11', fundId: BANK, direction: 'OUT', amountCents: 1_000 }),
    line({ id: 'v', day: '2026-10-11', fundId: BANK, direction: 'OUT', amountCents: 7_777, voided: { at: 'x', by: 'Mai', reason: 'trùng' } }),
    line({ id: 't1', day: '2026-10-12', fundId: CASH, direction: 'OUT', amountCents: 4_000, source: 'TRANSFER', countsInPl: false, transferId: 'T' }),
    line({ id: 't2', day: '2026-10-12', fundId: BANK, direction: 'IN', amountCents: 4_000, source: 'TRANSFER', countsInPl: false, transferId: 'T' }),
  ];

  it('opening + in − out = closing, for every fund and for all of them', () => {
    const r = assembleLedger(funds, base, '2026-10-10', '2026-10-31', null);
    // before the period: cash 10 000 + 5 000; bank 50 000 − 20 000
    expect(r.funds.find((f) => f.id === CASH)).toEqual({ id: CASH, openingCents: 15_000, inCents: 3_000, outCents: 4_000, closingCents: 14_000 });
    expect(r.funds.find((f) => f.id === BANK)).toEqual({ id: BANK, openingCents: 30_000, inCents: 4_000, outCents: 1_000, closingCents: 33_000 });
    expect(r.openingCents).toBe(45_000);
    // all funds: the transfer is shown, not counted
    expect(r.inCents).toBe(3_000);
    expect(r.outCents).toBe(1_000);
    expect(r.transferCents).toBe(4_000);
    expect(r.closingCents).toBe(47_000);
    expect(r.openingCents + r.inCents - r.outCents).toBe(r.closingCents);
  });

  it('a single fund counts its transfers as real money in or out', () => {
    const r = assembleLedger(funds, base, '2026-10-10', '2026-10-31', CASH);
    expect(r).toMatchObject({ openingCents: 15_000, inCents: 3_000, outCents: 4_000, closingCents: 14_000 });
    expect(r.lines.every((l) => l.fundId === CASH)).toBe(true);
  });

  it('a voided voucher is listed, crossed out, with no balance and no effect', () => {
    const r = assembleLedger(funds, base, '2026-10-10', '2026-10-31', BANK);
    const v = r.lines.find((l) => l.id === 'v')!;
    expect(v.balanceCents).toBeNull();
    expect(r.outCents).toBe(1_000);
  });

  it('newest first, each line with the balance right after it', () => {
    const r = assembleLedger(funds, base, '2026-10-10', '2026-10-31', CASH);
    expect(r.lines.map((l) => [l.id, l.balanceCents])).toEqual([['t1', 14_000], ['d', 18_000]]);
  });

  it('nothing before a fund’s opening day counts, and a fund opened after the period shows nothing', () => {
    const later: FundRow[] = [...funds, { id: 'f-new', kind: 'OTHER', name: 'Wallet', openingCents: 9_000, openingDate: '2026-11-05', isDefault: false, archived: false }];
    const r = assembleLedger(later, base, '2026-09-01', '2026-10-31', null);
    expect(r.lines.find((l) => l.id === 'a')).toBeUndefined();
    expect(r.funds.find((f) => f.id === 'f-new')).toEqual({ id: 'f-new', openingCents: 0, inCents: 0, outCents: 0, closingCents: 0 });
  });

  it('day totals leave out transfers in the all-funds view', () => {
    const r = assembleLedger(funds, base, '2026-10-10', '2026-10-31', null);
    expect(r.days.find((d) => d.day === '2026-10-12')).toBeUndefined();
    expect(r.days.find((d) => d.day === '2026-10-11')).toEqual({ day: '2026-10-11', inCents: 0, outCents: 1_000 });
  });
});

describe('profit & loss', () => {
  const sales = { grossCents: 50_000, discountCents: 2_000, refundCents: 3_000, netCents: 45_000, tipsCents: 6_000, taxCents: 800, serviceCents: 40_000, productCents: 5_000 };
  const cats = [
    { id: 'rent', name: 'Rent', group: 'OPS' as const, direction: 'OUT' as const, systemKey: 'rent', budgetCents: null },
    { id: 'ads', name: 'Ads', group: 'MARKETING' as const, direction: 'OUT' as const, systemKey: 'marketing', budgetCents: 1500 },
    { id: 'draw', name: 'Owner draw', group: 'NON_PL' as const, direction: 'OUT' as const, systemKey: 'owner_out', budgetCents: null },
    { id: 'oth', name: 'Other income', group: 'INCOME' as const, direction: 'IN' as const, systemKey: 'other_income', budgetCents: null },
  ];
  const lines: LedgerLine[] = [
    line({ id: 'sales', day: '2026-10-05', fundId: CASH, direction: 'IN', amountCents: 40_000, source: 'SALES', countsInPl: false }),
    line({ id: 'ref', day: '2026-10-05', fundId: CASH, direction: 'OUT', amountCents: 3_000, source: 'REFUND', countsInPl: false }),
    line({ id: 'rent', day: '2026-10-01', fundId: BANK, direction: 'OUT', amountCents: 4_500, categoryId: 'rent' }),
    line({ id: 'ads', day: '2026-10-02', fundId: BANK, direction: 'OUT', amountCents: 1_200, categoryId: 'ads' }),
    line({ id: 'ads-void', day: '2026-10-02', fundId: BANK, direction: 'OUT', amountCents: 9_999, categoryId: 'ads', voided: { at: 'x', by: null, reason: 'r' } }),
    line({ id: 'draw', day: '2026-10-03', fundId: BANK, direction: 'OUT', amountCents: 2_000, categoryId: 'draw', countsInPl: false }),
    line({ id: 'pay', day: '2026-10-04', fundId: BANK, direction: 'OUT', amountCents: 9_000, source: 'PAYROLL', countsInPl: false }),
    line({ id: 'mv', day: '2026-10-04', fundId: CASH, direction: 'OUT', amountCents: 180, source: 'DRAWER', needsReview: true }),
    line({ id: 'short', day: '2026-10-04', fundId: CASH, direction: 'OUT', amountCents: 120, source: 'SHIFT_DIFF' }),
    line({ id: 'misc', day: '2026-10-06', fundId: CASH, direction: 'IN', amountCents: 300, categoryId: 'oth' }),
    line({ id: 'xfer', day: '2026-10-06', fundId: CASH, direction: 'OUT', amountCents: 5_000, source: 'TRANSFER', countsInPl: false }),
  ];
  const payroll = [payrollFigures({ id: 'run1', periodFrom: '2026-09-28', periodTo: '2026-10-11', totals: { earningsCents: 15_000, adjustmentsCents: 500, tipsNetCents: 5_700, cardTipFeeCents: 300, netPayCents: 21_200 } })];

  it('revenue is the sales summary; staff cost is earnings + adjustments, never tips', () => {
    const p = buildPnl({ sales, payroll, supplyPurchaseCents: 2_000, lines, categories: cats });
    expect(p.revenue.netCents).toBe(45_000);
    const staff = p.expenses.find((s) => s.group === 'STAFF')!;
    expect(staff.totalCents).toBe(15_500);
    expect(p.otherIncome.rows.map((r) => [r.key, r.cents]).sort()).toEqual([['cat:oth', 300], ['tip_fee', 300]]);
    expect(p.expenses.find((s) => s.group === 'COGS')!.totalCents).toBe(2_000);
    expect(p.expenses.find((s) => s.group === 'OPS')!.totalCents).toBe(4_500);
    expect(p.expenses.find((s) => s.group === 'MARKETING')!.rows[0]).toMatchObject({ cents: 1_200, budgetCents: 1500 });
    expect(p.expenses.find((s) => s.group === 'OTHER')!.rows.map((r) => r.key).sort()).toEqual(['cash_short', 'unclassified_out']);
    // 45 000 + 600 − (15 500 + 2 000 + 4 500 + 1 200 + 300)
    expect(p.incomeCents).toBe(45_600);
    expect(p.expenseCents).toBe(23_500);
    expect(p.profitCents).toBe(22_100);
    expect(p.marginBp).toBe(Math.round((22_100 / 45_000) * 10000));
    expect(p.outside).toEqual({ tipsCents: 6_000, taxCents: 800, nonPlInCents: 0, nonPlOutCents: 2_000 });
    expect(p.unreviewedCents).toBe(180);
  });

  it('no sales, no margin', () => {
    const p = buildPnl({ sales: { ...sales, grossCents: 0, discountCents: 0, refundCents: 0, netCents: 0 }, payroll: [], supplyPurchaseCents: 0, lines: [], categories: [] });
    expect(p.marginBp).toBeNull();
    expect(p.profitCents).toBe(0);
  });
});

describe('recurring due days', () => {
  it('a month-end cost lands on the last day of short months and comes back to the 31st', () => {
    expect(advanceDue('2026-01-31', 'MONTHLY', '2026-01-31')).toBe('2026-02-28');
    expect(advanceDue('2026-02-28', 'MONTHLY', '2026-01-31')).toBe('2026-03-31');
    expect(advanceDue('2026-12-15', 'MONTHLY', '2026-12-15')).toBe('2027-01-15');
  });
  it('weekly and yearly (Feb 29 → Feb 28)', () => {
    expect(advanceDue('2026-10-20', 'WEEKLY', '2026-10-20')).toBe('2026-10-27');
    expect(advanceDue('2028-02-29', 'YEARLY', '2028-02-29')).toBe('2029-02-28');
    expect(advanceDue('2029-02-28', 'YEARLY', '2028-02-29')).toBe('2030-02-28');
  });
  it('every due day up to today, and the next one', () => {
    expect(dueDaysUpTo('2026-08-01', '2026-10-21', 'MONTHLY', '2026-08-01')).toEqual({ due: ['2026-08-01', '2026-09-01', '2026-10-01'], next: '2026-11-01' });
    expect(dueDaysUpTo('2026-11-01', '2026-10-21', 'MONTHLY', '2026-08-01')).toEqual({ due: [], next: '2026-11-01' });
  });
});

describe('vouchers', () => {
  it('numbers run with six digits', () => {
    expect(voucherCode('PC', 42)).toBe('PC-000042');
    expect(voucherCode('PT', 0)).toBe('PT-000001');
  });
  it('stored vouchers keep their own source and lock what the system wrote', () => {
    const base = { tenantId: 't', code: 'PC-000001', direction: 'OUT', fundId: CASH, categoryId: 'rent', amountCents: 100, countsInPl: true, occurredAt: at('2026-10-02'), day: '2026-10-02', payee: null, note: null, receiptUrl: null, sourceRef: null, transferId: null, createdByName: 'Mai', voidedAt: null, voidedByName: null, voidReason: null };
    const out = entryLines([
      { ...base, id: 'e1', source: 'MANUAL' },
      { ...base, id: 'e2', source: 'PAYROLL', sourceRef: 'run1:cash', countsInPl: false },
      { ...base, id: 'e3', source: 'TRANSFER', transferId: 'T', countsInPl: true },
    ], () => 'Rent');
    expect(out.map((l) => [l.source, l.locked, l.countsInPl])).toEqual([['MANUAL', false, true], ['PAYROLL', true, false], ['TRANSFER', false, false]]);
    expect(out[1].ref).toEqual({ kind: 'payroll', id: 'run1' });
  });
});
