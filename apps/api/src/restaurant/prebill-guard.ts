/**
 * rt234 — after the guest check (tạm tính) is printed (25/11/2026).
 *
 * The classic till fraud: print the guest check, the guest pays the printed
 * amount in cash, then the bill is voided, or dishes are taken off before it
 * is rung up, and the difference leaves in a pocket.
 *
 * Before the check is printed nothing changes: the waiter edits freely.
 * Once a guest check has been printed, only a change that LOWERS the bill
 * (taking dishes off, fewer of a dish, voiding the bill) needs a reason, and
 * the manager's approval where the salon turned that on (the same PIN rule as
 * taking back a sent dish). Adding dishes stays one tap. The amount on the last
 * printed check is kept, so a bill paid for less than the guest was shown is
 * written to the log and the owner is told.
 *
 * Pure: no database, no clock.
 */

export interface PrebillState { preBilledAt: Date | null; preBillCount?: number | null }

/** Is this a change that lowers a bill whose guest check was already printed? */
export function lowersPrintedBill(check: PrebillState, oldQty: number, newQty: number): boolean {
  if (!check.preBilledAt) return false;
  return Math.max(0, Math.round(newQty)) < Math.max(0, Math.round(oldQty));
}

/** Voiding the whole bill needs a reason (and approval) when the kitchen has dishes OR a guest check was printed. */
export function voidNeedsReason(check: PrebillState, sentLines: number): boolean {
  return sentLines > 0 || !!check.preBilledAt;
}

/** A clean reason, or null when it is too short to mean anything. */
export function reasonOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  return s.length >= 2 ? s : null;
}

/** How much less was rung up than the last guest check showed (0 when not less). */
export function shortOfPrinted(printedCents: number | null | undefined, paidCents: number): number {
  if (typeof printedCents !== 'number' || !(printedCents > 0)) return 0;
  const d = Math.round(printedCents) - Math.round(paidCents);
  return d > 0 ? d : 0;
}
