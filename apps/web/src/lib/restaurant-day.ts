/**
 * A RESTAURANT'S NIGHT (18/11/2026).
 *
 * A place that sells until two in the morning lives in nights, not calendar
 * days: the 01:43 bill belongs to the evening it was ordered in. The home
 * screen used to cut at midnight, so at 15:42 it showed last night's
 * after-midnight sales as "today, down 72%", and an owner could not compare
 * one night with the next. Everything here cuts the day at the restaurant's
 * own hour (Settings › Bàn & bếp, default 04:00), in the restaurant's time zone.
 *
 * Pure functions: the screens fetch, these count.
 */
import { dayKeyInTz, hourInTz, wallToInstantISO } from './datetime';

export const DEFAULT_DAY_START = 4;

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** The business day an instant belongs to. */
export function bizDayKey(at: string | number | Date, startHour: number, tz?: string): string {
  const d = new Date(at);
  return dayKeyInTz(new Date(d.getTime() - startHour * 3_600_000), tz);
}

/** [from, to] of one business day as ISO instants, `to` the last millisecond before the next day starts. */
export function bizWindow(dayKey: string, startHour: number, tz?: string): { from: string; to: string } {
  const hh = String(startHour).padStart(2, '0');
  const from = wallToInstantISO(`${dayKey}T${hh}:00`, tz);
  const next = wallToInstantISO(`${addDaysKey(dayKey, 1)}T${hh}:00`, tz);
  return { from, to: new Date(new Date(next).getTime() - 1).toISOString() };
}

export interface BizOrder {
  id: string; orderNumber: number; status: string; note?: string | null;
  subtotalCents: number; discountCents: number; totalCents: number; refundedCents?: number | null;
  createdAt: string; paidAt?: string | null;
  tenders?: { method: string; amountCents: number }[];
}

export const tableOf = (o: Pick<BizOrder, 'note'>): string => String(o.note ?? '').split('·')[0].trim() || '—';
export const checkNoOf = (o: Pick<BizOrder, 'note'>): number | null => { const m = /#(\d+)/.exec(String(o.note ?? '')); return m ? Number(m[1]) : null; };
const whenOf = (o: BizOrder) => o.paidAt || o.createdAt;
const tablesIn = (label: string) => label.split('+').map((s) => s.trim()).filter(Boolean);

export type Method = 'cash' | 'transfer' | 'card' | 'other';
export function methodOf(m: string): Method {
  const k = String(m ?? '').toUpperCase();
  if (k === 'CASH') return 'cash';
  if (k === 'CARD') return 'card';
  if (k === 'TRANSFER' || k === 'MOMO' || k === 'ZALOPAY' || k === 'VNPAY' || k === 'VIETQR' || k === 'BANK') return 'transfer';
  return 'other';
}

export interface NightStats {
  bills: number; netCents: number; grossCents: number; discountCents: number; avgCents: number;
  discountedBills: number; bigDiscounts: BizOrder[];
  byMethod: Record<Method, number>; transferBills: number;
  byHour: { hour: number; cents: number }[];
  voided: { order: BizOrder; replacement: BizOrder | null }[]; voidedCents: number;
  list: BizOrder[];
}

/** One night's bills, counted. `orders` may hold bills of other nights: only `dayKey`'s are counted. */
export function nightStats(orders: BizOrder[], dayKey: string, startHour: number, tz?: string): NightStats {
  const mine = orders.filter((o) => bizDayKey(whenOf(o), startHour, tz) === dayKey).sort((a, b) => +new Date(whenOf(a)) - +new Date(whenOf(b)));
  const paid = mine.filter((o) => o.status !== 'VOID');
  const voidedOrders = mine.filter((o) => o.status === 'VOID');
  const net = (o: BizOrder) => o.totalCents - (o.refundedCents ?? 0);
  const byMethod: Record<Method, number> = { cash: 0, transfer: 0, card: 0, other: 0 };
  let transferBills = 0;
  for (const o of paid) {
    let t = false;
    for (const x of o.tenders ?? []) { const k = methodOf(x.method); byMethod[k] += x.amountCents; if (k === 'transfer') t = true; }
    if (t) transferBills += 1;
  }
  const hours = new Map<number, number>();
  for (const o of paid) { const h = hourInTz(whenOf(o), tz); hours.set(h, (hours.get(h) ?? 0) + net(o)); }
  const order = (h: number) => (h - startHour + 24) % 24;
  const byHour = [...hours.entries()].map(([hour, cents]) => ({ hour, cents })).sort((a, b) => order(a.hour) - order(b.hour));
  // A bill taken back is often charged again on the same table soon after: the first paid bill
  // there in the next three hours is shown beside it, so the owner can compare the two amounts.
  const voided = voidedOrders.map((v) => {
    const t0 = +new Date(whenOf(v));
    const tabs = tablesIn(tableOf(v));
    const replacement = paid.find((p) => p.id !== v.id && +new Date(whenOf(p)) >= t0 && +new Date(whenOf(p)) - t0 <= 3 * 3_600_000 && tablesIn(tableOf(p)).some((x) => tabs.includes(x))) ?? null;
    return { order: v, replacement };
  });
  const netCents = paid.reduce((s, o) => s + net(o), 0);
  return {
    bills: paid.length, netCents,
    grossCents: paid.reduce((s, o) => s + o.subtotalCents, 0),
    discountCents: paid.reduce((s, o) => s + o.discountCents, 0),
    avgCents: paid.length ? Math.round(netCents / paid.length) : 0,
    discountedBills: paid.filter((o) => o.discountCents > 0).length,
    bigDiscounts: paid.filter((o) => o.subtotalCents > 0 && o.discountCents / o.subtotalCents >= 0.3),
    byMethod, transferBills, byHour,
    voided, voidedCents: voidedOrders.reduce((s, o) => s + o.totalCents, 0),
    list: mine,
  };
}

/** Whole nights a till shift has stayed open (0 while it is still the night it opened in). */
export function nightsOpen(openedAt: string, now: Date, startHour: number, tz?: string): number {
  const a = bizDayKey(openedAt, startHour, tz);
  const b = bizDayKey(now, startHour, tz);
  let n = 0;
  for (let k = a; k < b && n < 400; k = addDaysKey(k, 1)) n += 1;
  return n;
}

/** -12 → "▼ 12%"; null when there is nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/** "T3 17/11" (or "Tue 17/11"); long: "Thứ Ba 17/11". Built by hand so it never wraps or changes width. */
export function nightLabel(key: string, vi: boolean, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const dm = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  const shortVi = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const longVi = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${vi ? (long ? longVi : shortVi)[wd] : en[wd]} ${dm}`;
}
