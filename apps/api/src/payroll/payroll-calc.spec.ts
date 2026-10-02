import { allocate, buildLedger, UNASSIGNED } from './sales-ledger';
import { computePayslip, DEFAULT_PAYROLL_SETTINGS, PayConfig, PayrollSettings, salaryFor, sanitizeSettings, scheduledMinutes, commissionOnly } from './pay-calc';
import { periodContaining, recentPeriods } from './pay-period';

const day = (d: Date) => d.toISOString().slice(0, 10);
const bucket = (m: string) => (m === 'CARD' ? 'card' : m === 'CASH' ? 'cash' : 'other');
const at = (k: string) => new Date(`${k}T15:00:00Z`);

const ledgerOf = (orders: any[], appointments: any[] = [], paid: string[] = []) =>
  buildLedger({ orders, appointments, paidByTicket: new Set(paid), dayOf: day, bucket });

const order = (o: Partial<any> & { items: any[] }) => ({
  id: 'o', paidAt: at('2026-09-28'), discountCents: 0, changeCents: 0, giftCardAppliedCents: 0, tenders: [{ method: 'CASH', amountCents: 999999 }], ...o,
});
const svc = (staff: string | null, cents: number, tip = 0, qty = 1) => ({ kind: 'SERVICE', quantity: qty, lineTotalCents: cents, tipCents: tip, staffMemberId: staff });

const cfg = (p: Partial<PayConfig>): PayConfig => ({
  staffId: 'kim', name: 'Kim', payType: 'COMMISSION', commissionPercent: 60, productCommissionPercent: 0, hourlyRateCents: 0,
  dailyGuaranteeCents: 0, salaryCents: 0, salaryPeriod: 'MONTHLY', checkPercent: null, workingHours: [], ...p,
});
const S = (p: Partial<PayrollSettings> = {}): PayrollSettings => ({ ...DEFAULT_PAYROLL_SETTINGS, ...p });
const WEEK = { from: '2026-09-28', to: '2026-10-04' }; // Mon..Sun
const allDays = (s: string, e: string) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: s, endTime: e }));

describe('sales ledger', () => {
  it('splits a ticket discount over its lines, to the cent', () => {
    expect(allocate(1000, [6000, 4000])).toEqual([600, 400]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(500, [100])).toEqual([100]); // never more than the line
    const sum = allocate(997, [3333, 3333, 3334]);
    expect(sum.reduce((a, b) => a + b, 0)).toBe(997);
  });

  it('a $10 coupon on a $100 two-tech ticket is $90 of sales, split by size', () => {
    const l = ledgerOf([order({ discountCents: 1000, items: [svc('kim', 6000), svc('tina', 4000)] })]);
    expect(l.get('kim')!.serviceCents).toBe(5400);
    expect(l.get('tina')!.serviceCents).toBe(3600);
  });

  it('counts a visit per ticket, not per line, and keeps retail apart', () => {
    const l = ledgerOf([order({ items: [svc('kim', 4000), svc('kim', 1000), { kind: 'PRODUCT', quantity: 2, lineTotalCents: 3000, tipCents: 0, staffMemberId: 'kim' }] })]);
    const k = l.get('kim')!;
    expect(k).toMatchObject({ serviceCents: 5000, productCents: 3000, serviceCount: 2, visits: 1 });
  });

  it('tracks the card part of a tip by what was actually tendered', () => {
    // $100 ticket + $20 tip, paid $60 card and $80 cash with $20 change back => card 60 of 120 kept.
    const l = ledgerOf([order({ items: [svc('kim', 10000, 2000)], changeCents: 2000, tenders: [{ method: 'CARD', amountCents: 6000 }, { method: 'CASH', amountCents: 8000 }] })]);
    expect(l.get('kim')!.tipsCents).toBe(2000);
    expect(l.get('kim')!.cardTipsCents).toBe(1000);
  });

  it('counts a booking finished without the till, but never one a ticket closed', () => {
    const appts = [
      { id: 'a1', priceCents: 4500, assignedStaffId: 'kim', completedAt: at('2026-09-29') },
      { id: 'a2', priceCents: 9900, assignedStaffId: 'kim', completedAt: at('2026-09-29') },
    ];
    const l = ledgerOf([], appts, ['a2']);
    expect(l.get('kim')).toMatchObject({ serviceCents: 4500, visits: 1 });
    expect(l.get('kim')!.days['2026-09-29'].serviceCents).toBe(4500);
  });

  it('lines with no technician land on "unassigned"', () => {
    const l = ledgerOf([order({ items: [svc(null, 2500)] })]);
    expect(l.get(UNASSIGNED)!.serviceCents).toBe(2500);
  });
});

describe('pay periods', () => {
  it('weekly and two-weekly follow the anchor', () => {
    expect(periodContaining('WEEKLY', '2026-10-01', '2026-01-05')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(periodContaining('BIWEEKLY', '2026-10-01', '2026-01-05')).toEqual({ from: '2026-09-28', to: '2026-10-11' });
    expect(periodContaining('WEEKLY', '2025-12-31', '2026-01-05')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
  });
  it('semi-monthly and monthly use the calendar', () => {
    expect(periodContaining('SEMIMONTHLY', '2026-02-20')).toEqual({ from: '2026-02-16', to: '2026-02-28' });
    expect(periodContaining('MONTHLY', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('lists recent periods newest first', () => {
    expect(recentPeriods('MONTHLY', '2026-01-15', 2)).toEqual([{ from: '2026-01-01', to: '2026-01-31' }, { from: '2025-12-01', to: '2025-12-31' }]);
  });
});

describe('payslips', () => {
  const sales = ledgerOf([
    order({ paidAt: at('2026-09-28'), items: [svc('kim', 20000, 3000)], tenders: [{ method: 'CARD', amountCents: 23000 }] }),
    order({ paidAt: at('2026-09-29'), items: [svc('kim', 5000)] }),
  ]).get('kim');

  it('commission: % of service sales, tips on top', () => {
    const p = computePayslip({ cfg: cfg({}), ledger: sales, period: WEEK, settings: S() });
    expect(p).toMatchObject({ serviceCents: 25000, serviceCommissionCents: 15000, earningsCents: 15000, tipsCents: 3000, netPayCents: 18000 });
  });

  it('supply fee comes off before commission; card fee off the card part of tips', () => {
    const p = computePayslip({ cfg: cfg({}), ledger: sales, period: WEEK, settings: S({ supplyFeeMode: 'PER_SERVICE', supplyFeeCents: 300, cardTipFeePercent: 3 }) });
    expect(p.supplyFeeCents).toBe(600);
    expect(p.serviceCommissionCents).toBe(Math.round((25000 - 600) * 0.6));
    expect(p.cardTipFeeCents).toBe(90);
    expect(p.tipsNetCents).toBe(2910);
    const q = computePayslip({ cfg: cfg({}), ledger: sales, period: WEEK, settings: S({ supplyFeeMode: 'PERCENT', supplyFeePercent: 10 }) });
    expect(q.serviceCommissionCents).toBe(Math.round(22500 * 0.6));
  });

  it('retail has its own rate', () => {
    const l = ledgerOf([order({ items: [{ kind: 'PRODUCT', quantity: 1, lineTotalCents: 5000, tipCents: 0, staffMemberId: 'kim' }] })]).get('kim');
    expect(computePayslip({ cfg: cfg({ productCommissionPercent: 10 }), ledger: l, period: WEEK, settings: S() }).productCommissionCents).toBe(500);
  });

  it('hourly: scheduled hours up to today, minus days off, or the owner\'s hours', () => {
    const c = cfg({ payType: 'HOURLY', commissionPercent: 0, hourlyRateCents: 1500, workingHours: allDays('09:00', '17:00') });
    const p = computePayslip({ cfg: c, ledger: null, period: WEEK, upTo: '2026-09-30', settings: S(), override: { offDays: ['2026-09-29'] } });
    expect(p.hours).toBe(16); // Mon + Wed, 8h each
    expect(p.hourlyPayCents).toBe(24000);
    const q = computePayslip({ cfg: c, ledger: null, period: WEEK, settings: S(), override: { hours: 37.5 } });
    expect(q.hourlyPayCents).toBe(56250);
  });

  it('hourly + commission when a % is set', () => {
    const c = cfg({ payType: 'HOURLY', commissionPercent: 10, hourlyRateCents: 1000, workingHours: [{ dayOfWeek: 1, startTime: '10:00', endTime: '14:00' }] });
    const p = computePayslip({ cfg: c, ledger: sales, period: WEEK, settings: S() });
    expect(p.hourlyPayCents).toBe(4000);
    expect(p.earningsCents).toBe(4000 + 2500);
  });

  it('daily guarantee is compared DAY BY DAY', () => {
    // Mon sold $200 (60% = $120), Tue $50 ($30), Wed scheduled, nothing sold. Guarantee $100/day.
    const c = cfg({ payType: 'DAILY_GUARANTEE', dailyGuaranteeCents: 10000, workingHours: [1, 2, 3].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '18:00' })) });
    const p = computePayslip({ cfg: c, ledger: sales, period: WEEK, settings: S() });
    expect(p.days.map((d) => [d.day, d.paidCents])).toEqual([['2026-09-28', 12000], ['2026-09-29', 10000], ['2026-09-30', 10000]]);
    expect(p.earningsCents).toBe(32000);
    expect(p.guaranteeTopUpCents).toBe(32000 - 15000);
    expect(p.daysWorked).toBe(3);
    // A day marked off pays its commission only.
    const q = computePayslip({ cfg: c, ledger: sales, period: WEEK, settings: S(), override: { offDays: ['2026-09-29', '2026-09-30'] } });
    expect(q.earningsCents).toBe(12000 + 3000);
    expect(q.daysWorked).toBe(1);
  });

  it('salary is prorated to the period, never paid in full for a week', () => {
    expect(salaryFor(300000, 'MONTHLY', '2026-09-01', '2026-09-30')).toBe(300000);
    expect(salaryFor(310000, 'MONTHLY', '2026-10-01', '2026-10-31')).toBe(310000);
    expect(salaryFor(300000, 'MONTHLY', '2026-09-28', '2026-10-04')).toBe(Math.round(300000 * 3 / 30 + 300000 * 4 / 31));
    expect(salaryFor(70000, 'WEEKLY', WEEK.from, WEEK.to)).toBe(70000);
    expect(salaryFor(140000, 'BIWEEKLY', WEEK.from, WEEK.to)).toBe(70000);
    const p = computePayslip({ cfg: cfg({ payType: 'SALARY', commissionPercent: 0, salaryCents: 70000, salaryPeriod: 'WEEKLY' }), ledger: null, period: WEEK, upTo: '2026-09-30', settings: S() });
    expect(p.salaryForPeriodCents).toBe(30000); // 3 of 7 days so far
  });

  it('bonuses and deductions, then the check / cash split', () => {
    const p = computePayslip({
      cfg: cfg({ checkPercent: 60 }), ledger: sales, period: WEEK, settings: S(),
      override: { adjustments: [{ label: 'Thưởng', cents: 2000 }, { label: 'Ứng trước', cents: -5000 }] },
    });
    expect(p.adjustmentsCents).toBe(-3000);
    expect(p.netPayCents).toBe(15000 + 3000 - 3000);
    expect(p.checkCents).toBe(9000);
    expect(p.cashCents).toBe(6000);
    const d = computePayslip({ cfg: cfg({}), ledger: sales, period: WEEK, settings: S({ defaultCheckPercent: 70 }) });
    expect(d.checkCents + d.cashCents).toBe(d.netPayCents);
    expect(d.checkPercent).toBe(70);
  });

  it('the sales report\'s commission is the payroll\'s commission', () => {
    const st = S({ supplyFeeMode: 'PER_SERVICE', supplyFeeCents: 300 });
    const p = computePayslip({ cfg: cfg({}), ledger: sales, period: WEEK, settings: st });
    expect(commissionOnly(cfg({}), sales!, st)).toBe(p.serviceCommissionCents + p.productCommissionCents);
  });

  it('schedule minutes add split shifts and skip inactive rows', () => {
    const m = scheduledMinutes({ workingHours: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }, { dayOfWeek: 1, startTime: '13:00', endTime: '18:00' }, { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: false }] }, WEEK.from, WEEK.to);
    expect(m).toEqual({ '2026-09-28': 480 });
  });

  it('settings are clamped to sane values', () => {
    expect(sanitizeSettings({ payPeriod: 'DAILY' as never, cardTipFeePercent: 99, defaultCheckPercent: 140 })).toMatchObject({ payPeriod: 'WEEKLY', cardTipFeePercent: 20, defaultCheckPercent: 100 });
  });
});
