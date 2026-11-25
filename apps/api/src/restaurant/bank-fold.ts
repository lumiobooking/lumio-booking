/**
 * rt235 — money that came in by bank transfer is never counted as cash (25/11/2026).
 *
 * An owner put 3 million in the drawer, the till said 27 million in sales,
 * and the drawer held 22 million at close. One way the till itself made the
 * drawer look short: a table that paid (part of) its bill by VietQR / bank
 * transfer — the money auto-matched by SePay / Casso into `bankPaidCents` —
 * was then closed with the default "Tiền mặt" button, or with the full total
 * typed as cash. The order said CASH for money that was in the bank, so the
 * shift expected that much more in the drawer.
 *
 * The server now folds what the bank already received into the tenders,
 * whatever the screen sent: the bank part becomes a bank tender; when cash
 * was also handed in, the excess is change (so the drawer is expected to hold
 * only the real cash); without cash, the other non-cash lines shrink instead.
 *
 * Pure.
 */
export type Tender = { method: string; amountCents: number };

const BANK = new Set(['VIETQR', 'TRANSFER']);

export function foldBankCredit(tenders: Tender[], bankPaidCents: number, bankMethod: 'VIETQR' | 'TRANSFER' = 'VIETQR'): { tenders: Tender[]; addedCents: number } {
  const list = tenders.map((t) => ({ method: t.method, amountCents: Math.max(0, Math.round(t.amountCents)) })).filter((t) => t.amountCents > 0);
  const bank = Math.max(0, Math.round(bankPaidCents || 0));
  if (!bank) return { tenders: list, addedCents: 0 };
  const already = list.filter((t) => BANK.has(t.method)).reduce((s, t) => s + t.amountCents, 0);
  // Never more than the screen's own non-bank lines: a transfer bigger than the bill
  // must not turn into "change" taken out of the drawer.
  const others = list.filter((t) => !BANK.has(t.method)).reduce((s, t) => s + t.amountCents, 0);
  const missing = Math.min(bank - already, others);
  if (missing <= 0) return { tenders: list, addedCents: 0 };
  const hasCash = list.some((t) => t.method === 'CASH');
  if (!hasCash) {
    // Card / wallet lines were typed for money the bank already has: shrink them.
    let left = missing;
    for (const t of list) {
      if (BANK.has(t.method) || left <= 0) continue;
      const cut = Math.min(t.amountCents, left);
      t.amountCents -= cut;
      left -= cut;
    }
  }
  // With cash on the bill, the extra comes back as change: the drawer keeps only the real cash.
  const out = list.filter((t) => t.amountCents > 0);
  out.push({ method: bankMethod, amountCents: missing });
  return { tenders: out, addedCents: missing };
}
