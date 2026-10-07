import { addDays, daysBetween, daysInMonth, eachDay, PayPeriodKind, weekdayOf } from './pay-period';
import type { DayBucket, StaffLedger } from './sales-ledger';

/**
 * WHAT A TECHNICIAN IS OWED FOR A PAY PERIOD — a pure function, so every rule
 * below is pinned by a test rather than by a screenshot.
 *
 *   COMMISSION       service sales × % (+ retail × retail %)
 *   HOURLY           hours × rate (+ commission, when a % is set)
 *   DAILY_GUARANTEE  each day worked pays the HIGHER of the guarantee and that
 *                    day's commission — compared day by day, the way salons
 *                    promise it ("bao $120 một ngày"), never over the week
 *   SALARY           the salary prorated to the period's days (+ commission,
 *                    when a % is set). A weekly look at a monthly salary is
 *                    7 days of it, not all of it.
 *
 * Then: the salon's supply fee comes off the service sales BEFORE commission,
 * the card fee comes off the card part of tips, bonuses / deductions are added,
 * and the net is split into check and cash by the tech's (or salon's) ratio.
 *
 * Hours and days come from the working schedule (what the owner chose), only
 * up to today for a period still running; the owner can correct both on the
 * draft before closing the period.
 */

export type PayType = 'COMMISSION' | 'HOURLY' | 'DAILY_GUARANTEE' | 'SALARY';
export const PAY_TYPES: PayType[] = ['COMMISSION', 'HOURLY', 'DAILY_GUARANTEE', 'SALARY'];
export type SalaryPeriod = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface PayConfig {
  staffId: string;
  name: string;
  payType: PayType | string;
  commissionPercent: number;
  productCommissionPercent: number;
  hourlyRateCents: number;
  dailyGuaranteeCents: number;
  salaryCents: number;
  salaryPeriod: SalaryPeriod | string;
  checkPercent: number | null;
  /** Weekly schedule: one row per working window. */
  workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }[];
}

export interface PayrollSettings {
  payPeriod: PayPeriodKind;
  /** First day of any weekly / two-weekly period. */
  periodAnchor: string;
  supplyFeeMode: 'NONE' | 'PER_SERVICE' | 'PERCENT';
  supplyFeeCents: number;
  supplyFeePercent: number;
  /** Percent taken off the card part of tips (processing fee), e.g. 3 or 2.9. */
  cardTipFeePercent: number;
  /** Share of net pay paid by check when the tech has no ratio of their own. */
  defaultCheckPercent: number;
  /**
   * What a technician sees of her own pay in her app (Thu nhập):
   * LIVE = the running estimate of the open period plus closed payslips;
   * FINAL = closed payslips only; OFF = nothing.
   */
  staffPayView: 'LIVE' | 'FINAL' | 'OFF';
  /** Where worked hours / days come from: the schedule (default) or the time clock (time_entries). */
  hoursSource: 'SCHEDULE' | 'CLOCK';
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  payPeriod: 'WEEKLY',
  periodAnchor: '2026-01-05', // a Monday
  supplyFeeMode: 'NONE',
  supplyFeeCents: 0,
  supplyFeePercent: 0,
  cardTipFeePercent: 0,
  defaultCheckPercent: 100,
  staffPayView: 'LIVE',
  hoursSource: 'SCHEDULE',
};

export interface Adjustment { label: string; cents: number }
export interface PayOverride {
  /** Hours worked, replacing the schedule's figure (HOURLY). */
  hours?: number | null;
  /** Days the tech did not come in (no guarantee, no hours for those days). */
  offDays?: string[];
  adjustments?: Adjustment[];
}

export interface PayDay {
  day: string;
  serviceCents: number;
  commissionCents: number;
  guaranteeCents: number;
  paidCents: number;
  off: boolean;
}

export interface Payslip {
  staffId: string;
  name: string;
  payType: PayType;
  commissionPercent: number;
  productCommissionPercent: number;
  // Sales
  serviceCents: number;
  productCents: number;
  serviceCount: number;
  visits: number;
  supplyFeeCents: number;
  // Earnings
  serviceCommissionCents: number;
  productCommissionCents: number;
  hours: number;
  hoursFromSchedule: number;
  /** Where hours / worked days came from, and the clocked hours when it was the clock. */
  hoursSource?: 'SCHEDULE' | 'CLOCK';
  clockedHours?: number;
  /** Whole days off that came from approved time off (nghỉ phép), not the owner's chips. */
  leaveDays?: string[];
  hourlyRateCents: number;
  hourlyPayCents: number;
  daysWorked: number;
  dailyGuaranteeCents: number;
  guaranteeTopUpCents: number;
  salaryCents: number;
  salaryForPeriodCents: number;
  earningsCents: number;
  // Tips
  tipsCents: number;
  cardTipsCents: number;
  cardTipFeeCents: number;
  tipsNetCents: number;
  // Adjustments & payout
  adjustments: Adjustment[];
  adjustmentsCents: number;
  netPayCents: number;
  checkPercent: number;
  checkCents: number;
  cashCents: number;
  days: PayDay[];
}

const pct = (cents: number, p: number) => Math.round((cents * (Number(p) || 0)) / 100);
const clampPct = (p: unknown, dflt: number) => { const n = Number(p); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : dflt; };
const hm = (v: string) => { const [h, m] = String(v || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export function normalizePayType(t: unknown): PayType {
  return (PAY_TYPES as string[]).includes(String(t)) ? (t as PayType) : 'COMMISSION';
}

/** Scheduled minutes on each day of [from, to]. */
export function scheduledMinutes(cfg: Pick<PayConfig, 'workingHours'>, from: string, to: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of eachDay(from, to)) {
    const dow = weekdayOf(day);
    const mins = cfg.workingHours
      .filter((w) => w.dayOfWeek === dow && w.isActive !== false)
      .reduce((s, w) => s + Math.max(0, hm(w.endTime) - hm(w.startTime)), 0);
    if (mins > 0) out[day] = mins;
  }
  return out;
}

/** A salary for [from, to]: whole calendar months pay the month; anything else by the day. */
export function salaryFor(salaryCents: number, period: SalaryPeriod | string, from: string, to: string): number {
  if (salaryCents <= 0 || to < from) return 0;
  const days = daysBetween(from, to);
  if (period === 'WEEKLY') return Math.round((salaryCents * days) / 7);
  if (period === 'BIWEEKLY') return Math.round((salaryCents * days) / 14);
  // MONTHLY: each day is 1/(days in its month) of the salary — so a whole
  // calendar month is exactly one salary whatever its length.
  let total = 0;
  for (const day of eachDay(from, to)) total += salaryCents / daysInMonth(day);
  return Math.round(total);
}

function supplyFee(b: Pick<DayBucket, 'serviceCents' | 'serviceCount'>, s: PayrollSettings): number {
  if (s.supplyFeeMode === 'PER_SERVICE') return Math.min(b.serviceCents, Math.max(0, s.supplyFeeCents) * b.serviceCount);
  if (s.supplyFeeMode === 'PERCENT') return Math.min(b.serviceCents, pct(b.serviceCents, s.supplyFeePercent));
  return 0;
}

export function computePayslip(input: {
  cfg: PayConfig;
  ledger: StaffLedger | null | undefined;
  period: { from: string; to: string };
  /** Last day that counts as worked so far (today, for a period still running). */
  upTo?: string;
  settings: PayrollSettings;
  override?: PayOverride | null;
  /** Clocked minutes per salon day (payroll/time-clock.ts) — used when settings.hoursSource is CLOCK. */
  clock?: Record<string, number> | null;
}): Payslip {
  const { cfg, settings: s, period } = input;
  const payType = normalizePayType(cfg.payType);
  const led = input.ledger;
  const ov = input.override ?? {};
  const last = input.upTo && input.upTo < period.to ? input.upTo : period.to;
  const off = new Set((ov.offDays ?? []).filter((d) => d >= period.from && d <= period.to));
  const cPct = clampPct(cfg.commissionPercent, 0);
  const pPct = clampPct(cfg.productCommissionPercent, 0);

  const serviceCents = led?.serviceCents ?? 0;
  const productCents = led?.productCents ?? 0;
  const serviceCount = led?.serviceCount ?? 0;
  const supply = supplyFee({ serviceCents, serviceCount }, s);

  // Commission (all types may carry one; for SALARY / HOURLY it is "on top").
  const serviceCommissionCents = pct(serviceCents - supply, cPct);
  const productCommissionCents = pct(productCents, pPct);

  // Schedule, up to today, minus days the owner marked off.
  const sched = last >= period.from ? scheduledMinutes(cfg, period.from, last) : {};
  const schedMinutes = Object.entries(sched).filter(([d]) => !off.has(d)).reduce((a, [, m]) => a + m, 0);
  const hoursFromSchedule = Math.round((schedMinutes / 60) * 100) / 100;
  // The time clock, when the salon pays by it: clocked minutes in the period, minus days marked off.
  const useClock = s.hoursSource === 'CLOCK' && !!input.clock;
  const clocked = useClock ? Object.fromEntries(Object.entries(input.clock ?? {}).filter(([d, m]) => d >= period.from && d <= last && m > 0 && !off.has(d))) : {};
  const clockedHours = Math.round((Object.values(clocked).reduce((a, m) => a + m, 0) / 60) * 100) / 100;

  let hours = 0, hourlyPayCents = 0, guaranteeTopUpCents = 0, salaryForPeriodCents = 0, daysWorked = 0;
  const days: PayDay[] = [];
  let earningsCents = serviceCommissionCents + productCommissionCents;

  if (payType === 'HOURLY') {
    hours = ov.hours != null && Number.isFinite(Number(ov.hours)) ? Math.max(0, Number(ov.hours)) : useClock ? clockedHours : hoursFromSchedule;
    hourlyPayCents = Math.round(hours * Math.max(0, cfg.hourlyRateCents));
    earningsCents += hourlyPayCents;
  } else if (payType === 'SALARY') {
    salaryForPeriodCents = last >= period.from ? salaryFor(cfg.salaryCents, cfg.salaryPeriod, period.from, last) : 0;
    earningsCents += salaryForPeriodCents;
  } else if (payType === 'DAILY_GUARANTEE') {
    // Every day the tech was scheduled (and not marked off), plus any day they
    // actually sold — the guarantee is per day, against that day's commission.
    // With the time clock, the days she clocked in replace the schedule's days.
    const dayKeys = new Set<string>([...Object.keys(useClock ? clocked : sched), ...Object.keys(led?.days ?? {}).filter((d) => d >= period.from && d <= period.to)]);
    let sum = 0;
    for (const day of [...dayKeys].sort()) {
      const b = led?.days?.[day];
      const svc = b?.serviceCents ?? 0;
      const fee = b ? supplyFee(b, s) : 0;
      const commission = pct(svc - fee, cPct) + pct(b?.productCents ?? 0, pPct);
      // Clock mode: a day she sold but never clocked in earns its commission only.
      const isOff = off.has(day) || (useClock && !clocked[day]);
      const guarantee = isOff ? 0 : Math.max(0, cfg.dailyGuaranteeCents);
      const paid = Math.max(guarantee, commission);
      if (!isOff) daysWorked += 1;
      days.push({ day, serviceCents: svc, commissionCents: commission, guaranteeCents: guarantee, paidCents: paid, off: isOff });
      sum += paid;
    }
    // Day-by-day rounding may differ by a cent from the period total; the
    // guaranteed days are what is owed, so the per-day sum is the earnings.
    guaranteeTopUpCents = Math.max(0, sum - (serviceCommissionCents + productCommissionCents));
    earningsCents = sum;
  }
  if (payType !== 'DAILY_GUARANTEE') daysWorked = useClock ? Object.keys(clocked).length : Object.keys(sched).filter((d) => !off.has(d)).length;

  const tipsCents = led?.tipsCents ?? 0;
  const cardTipsCents = led?.cardTipsCents ?? 0;
  const cardTipFeeCents = Math.min(cardTipsCents, Math.round((cardTipsCents * Math.max(0, Number(s.cardTipFeePercent) || 0)) / 100));
  const tipsNetCents = tipsCents - cardTipFeeCents;

  const adjustments = (ov.adjustments ?? [])
    .map((a) => ({ label: String(a.label ?? '').slice(0, 80), cents: Math.round(Number(a.cents) || 0) }))
    .filter((a) => a.cents !== 0);
  const adjustmentsCents = adjustments.reduce((a, b) => a + b.cents, 0);

  const netPayCents = earningsCents + tipsNetCents + adjustmentsCents;
  const checkPercent = clampPct(cfg.checkPercent ?? s.defaultCheckPercent, 100);
  const checkCents = netPayCents > 0 ? Math.round((netPayCents * checkPercent) / 100) : netPayCents;
  const cashCents = netPayCents - checkCents;

  return {
    staffId: cfg.staffId, name: cfg.name, payType,
    commissionPercent: cPct, productCommissionPercent: pPct,
    serviceCents, productCents, serviceCount, visits: led?.visits ?? 0, supplyFeeCents: supply,
    serviceCommissionCents, productCommissionCents,
    hours: Math.round(hours * 100) / 100, hoursFromSchedule, hoursSource: useClock ? 'CLOCK' : 'SCHEDULE', clockedHours: useClock ? clockedHours : undefined, hourlyRateCents: cfg.hourlyRateCents, hourlyPayCents,
    daysWorked, dailyGuaranteeCents: cfg.dailyGuaranteeCents, guaranteeTopUpCents,
    salaryCents: cfg.salaryCents, salaryForPeriodCents,
    earningsCents,
    tipsCents, cardTipsCents, cardTipFeeCents, tipsNetCents,
    adjustments, adjustmentsCents,
    netPayCents, checkPercent, checkCents, cashCents,
    days,
  };
}

/** Commission alone (what the sales report shows), by the same rules as payroll. */
export function commissionOnly(cfg: Pick<PayConfig, 'commissionPercent' | 'productCommissionPercent'>, led: Pick<DayBucket, 'serviceCents' | 'productCents' | 'serviceCount'>, s: PayrollSettings): number {
  return pct(led.serviceCents - supplyFee(led, s), clampPct(cfg.commissionPercent, 0)) + pct(led.productCents, clampPct(cfg.productCommissionPercent, 0));
}

export function sanitizeSettings(raw: Partial<PayrollSettings> | null | undefined): PayrollSettings {
  const r = { ...DEFAULT_PAYROLL_SETTINGS, ...(raw ?? {}) };
  const kinds: PayPeriodKind[] = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'];
  return {
    payPeriod: kinds.includes(r.payPeriod) ? r.payPeriod : 'WEEKLY',
    periodAnchor: /^\d{4}-\d{2}-\d{2}$/.test(String(r.periodAnchor)) ? r.periodAnchor : DEFAULT_PAYROLL_SETTINGS.periodAnchor,
    supplyFeeMode: (['NONE', 'PER_SERVICE', 'PERCENT'] as const).includes(r.supplyFeeMode) ? r.supplyFeeMode : 'NONE',
    supplyFeeCents: Math.max(0, Math.round(Number(r.supplyFeeCents) || 0)),
    supplyFeePercent: clampPct(r.supplyFeePercent, 0),
    cardTipFeePercent: Math.min(20, Math.max(0, Math.round((Number(r.cardTipFeePercent) || 0) * 100) / 100)),
    defaultCheckPercent: clampPct(r.defaultCheckPercent, 100),
    staffPayView: r.staffPayView === 'FINAL' || r.staffPayView === 'OFF' ? r.staffPayView : 'LIVE',
    hoursSource: r.hoursSource === 'CLOCK' ? 'CLOCK' : 'SCHEDULE',
  };
}

export { addDays };
