/**
 * WHAT HAPPENS TO THE MONEY WHEN A PAID BOOKING IS CANCELLED.
 *
 * The salon's rule, one number: cancel at least `refundHours` before the
 * appointment and the money goes back to the card (for real, through the
 * provider that took it); cancel later — or not show up — and the salon keeps
 * the deposit. Only the DEPOSIT is kept: a client who prepaid the whole visit
 * and cancels late gets back everything above the deposit the salon's rule
 * asks for. A salon with no deposit rule keeps nothing.
 *
 * Staff can decide otherwise for one booking (a sick child, a snowstorm):
 * `override` wins, and is only ever passed from a staff action.
 *
 * Pure: no database, no clock (tested in deposit-policy.spec.ts).
 */
export const HOUR_MS = 3_600_000;
export const DEFAULT_REFUND_HOURS = 24;

export type MoneyChoice = 'refund' | 'keep';

export interface CancelMoneyInput {
  startMs: number;
  nowMs: number;
  /** The salon's rule: hours of notice for a refund. */
  refundHours: number;
  /** Money actually taken on the booking. */
  paidCents: number;
  /** The deposit the salon's rule asks for this booking (0 = no deposit rule). */
  depositCents: number;
  /** Staff decision for this one booking. */
  override?: MoneyChoice | null;
}

export interface CancelMoneyPlan {
  keepCents: number;
  refundCents: number;
  reason: 'nothing' | 'override' | 'early' | 'late';
}

export function cancelMoney(i: CancelMoneyInput): CancelMoneyPlan {
  const paid = Math.max(0, Math.round(i.paidCents || 0));
  if (paid <= 0) return { keepCents: 0, refundCents: 0, reason: 'nothing' };
  if (i.override === 'refund') return { keepCents: 0, refundCents: paid, reason: 'override' };
  if (i.override === 'keep') return { keepCents: paid, refundCents: 0, reason: 'override' };
  if (refundable(i.startMs, i.nowMs, i.refundHours)) return { keepCents: 0, refundCents: paid, reason: 'early' };
  const keep = Math.min(paid, Math.max(0, Math.round(i.depositCents || 0)));
  return { keepCents: keep, refundCents: paid - keep, reason: 'late' };
}

/** Is there still time to cancel with the money back? */
export function refundable(startMs: number, nowMs: number, refundHours: number): boolean {
  const h = Number.isFinite(refundHours) ? Math.max(0, refundHours) : DEFAULT_REFUND_HOURS;
  return startMs - nowMs >= h * HOUR_MS;
}

/** The last moment a cancellation still gets the money back. */
export function refundDeadline(startMs: number, refundHours: number): number {
  return startMs - Math.max(0, refundHours) * HOUR_MS;
}

/**
 * Spread a refund over the payments that were taken, largest first. A
 * payment refunded in part is split in two rows by the caller (what stays,
 * what went back), so every row keeps meaning "this much, in this state".
 */
export function allocateRefund(rows: { id: string; amountCents: number }[], refundCents: number): { id: string; refundCents: number; whole: boolean }[] {
  let left = Math.max(0, Math.round(refundCents));
  const out: { id: string; refundCents: number; whole: boolean }[] = [];
  for (const r of [...rows].sort((a, b) => b.amountCents - a.amountCents)) {
    if (left <= 0) break;
    const take = Math.min(left, r.amountCents);
    if (take <= 0) continue;
    out.push({ id: r.id, refundCents: take, whole: take === r.amountCents });
    left -= take;
  }
  return out;
}
