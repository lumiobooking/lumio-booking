/**
 * THU NHẬP CẢ NĂM — pure. The technician's closed payslips of one year added
 * up, the way she needs them for her taxes: what she sold, what she was paid
 * for it, tips, bonuses and deductions, what went out by check and in cash.
 * Only FINAL payroll runs count (an estimate is not a statement), and a run
 * belongs to the year its period starts in.
 */

export interface YearLine {
  staffId: string;
  serviceCents: number; productCents: number; supplyFeeCents: number;
  serviceCommissionCents: number; productCommissionCents: number;
  hourlyPayCents: number; guaranteeTopUpCents: number; salaryForPeriodCents: number; earningsCents: number;
  tipsCents: number; cardTipFeeCents: number; tipsNetCents: number;
  adjustmentsCents: number; netPayCents: number; checkCents: number; cashCents: number;
  visits?: number;
}
export interface YearRun { periodFrom: string; periodTo: string; finalizedAt: Date | null; lines: unknown }

export const SUM_KEYS = [
  'serviceCents', 'productCents', 'supplyFeeCents', 'serviceCommissionCents', 'productCommissionCents',
  'hourlyPayCents', 'guaranteeTopUpCents', 'salaryForPeriodCents', 'earningsCents',
  'tipsCents', 'cardTipFeeCents', 'tipsNetCents', 'adjustmentsCents', 'netPayCents', 'checkCents', 'cashCents',
] as const;
export type SumKey = (typeof SUM_KEYS)[number];
export type Totals = Record<SumKey, number> & { visits: number; periods: number };

export interface YearRow extends Record<SumKey, number> { from: string; to: string; finalizedAt: Date | null; visits: number }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

/** This technician's line in a frozen run, or null when she had none. */
export function lineOf(lines: unknown, staffId: string): YearLine | null {
  if (!Array.isArray(lines)) return null;
  return (lines as YearLine[]).find((l) => l && l.staffId === staffId) ?? null;
}

/** The years that have at least one closed payslip for her, newest first. */
export function yearsWithPay(runs: YearRun[], staffId: string): number[] {
  const ys = new Set<number>();
  for (const r of runs) if (lineOf(r.lines, staffId)) ys.add(Number(r.periodFrom.slice(0, 4)));
  return [...ys].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}

export function yearSummary(runs: YearRun[], staffId: string, year: number): { rows: YearRow[]; totals: Totals } {
  const rows: YearRow[] = [];
  for (const r of runs) {
    if (Number(r.periodFrom.slice(0, 4)) !== year) continue;
    const l = lineOf(r.lines, staffId);
    if (!l) continue;
    const row = { from: r.periodFrom, to: r.periodTo, finalizedAt: r.finalizedAt, visits: n(l.visits) } as YearRow;
    for (const k of SUM_KEYS) row[k] = n(l[k]);
    rows.push(row);
  }
  rows.sort((a, b) => a.from.localeCompare(b.from));
  const totals = { visits: 0, periods: rows.length } as Totals;
  for (const k of SUM_KEYS) totals[k] = rows.reduce((s, r) => s + r[k], 0);
  totals.visits = rows.reduce((s, r) => s + r.visits, 0);
  return { rows, totals };
}
