/**
 * XOÁ DỮ LIỆU BÁN HÀNG THỬ — the rules (pure). The database half is
 * test-reset.service.ts.
 *
 * Before a shop is handed over, the owner wipes the bills they rang up while
 * trying the till: from one day of their choosing (or everything) up to now.
 * Menu, tables, staff, products, clients and settings stay; the sales go,
 * bill numbers start again after the last bill kept, and stock, loyalty
 * points and gift-card balances are put back as if the test never happened.
 *
 * Refused while a closed (FINAL) payroll covers any of those days — that pay
 * was handed over on these sales.
 */
import { dayKeyTz, startOfDayTz } from '../common/salon-time';

/** What the owner must type to confirm. "XOÁ", "xóa", "xoa" all count. */
export const RESET_WORD = 'XOA';

export function confirmed(text: unknown): boolean {
  const s = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').trim().toUpperCase();
  return s === RESET_WORD;
}

export interface ResetWindow {
  /** First salon day wiped, or null for everything. */
  fromDay: string | null;
  /** The salon's today (the last day wiped). */
  today: string;
  /** Start of fromDay in the salon's zone (null = from the beginning). */
  fromUtc: Date | null;
}

/** null when the day is not a real YYYY-MM-DD or is after today. */
export function resetWindow(from: unknown, tz: string, now: Date = new Date()): ResetWindow | null {
  const today = dayKeyTz(now, tz);
  const raw = String(from ?? '').trim();
  if (!raw) return { fromDay: null, today, fromUtc: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  if (raw > today) return null;
  return { fromDay: raw, today, fromUtc: startOfDayTz(raw, tz) };
}

/** A closed payroll that covers any day being wiped. */
export function lockedPayroll(runs: { periodFrom: string; periodTo: string }[], w: ResetWindow): { periodFrom: string; periodTo: string } | null {
  return runs.find((r) => String(r.periodTo) >= (w.fromDay ?? '0000-00-00') && String(r.periodFrom) <= w.today) ?? null;
}

/** Points each client still holds from these bills (earned − redeemed − already reversed). */
export function loyaltyNet(txns: { customerId: string; points: number }[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const t of txns) by.set(t.customerId, (by.get(t.customerId) ?? 0) + (t.points || 0));
  for (const [k, v] of by) if (v === 0) by.delete(k);
  return by;
}

/** Gift-card money spent on these bills, per card (REDEEM is stored negative; a later ADJUST already gave some back). */
export function giftCardCredit(txns: { giftCardId: string; kind: string; amountCents: number }[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== 'REDEEM' && t.kind !== 'ADJUST') continue;
    by.set(t.giftCardId, (by.get(t.giftCardId) ?? 0) - (t.amountCents || 0));
  }
  for (const [k, v] of by) if (v <= 0) by.delete(k);
  return by;
}

/** Product units sold on bills that were still live sales (a void already put them back). */
export function restock(orders: { status: string; items: { kind: string; productId: string | null; quantity: number }[] }[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== 'PAID') continue;
    for (const l of o.items) if (l.kind === 'PRODUCT' && l.productId) by.set(l.productId, (by.get(l.productId) ?? 0) + (l.quantity || 0));
  }
  return by;
}
