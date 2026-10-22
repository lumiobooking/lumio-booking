/**
 * The restaurant till's small rules, kept out of the component so they are
 * tested: what colour a table is, how long it has been seated, which industry
 * gets the table till, and what a server error means in words.
 */

export type TableState = 'free' | 'seated' | 'ordered' | 'unsent' | 'prebilled' | 'paying';

export interface FloorCheck {
  id: string;
  number: number;
  status: string;
  tableIds: string[];
  tables: string;
  guests: number;
  serverName: string | null;
  openedAt: string;
  preBilledAt: string | null;
  subtotalCents: number;
  itemCount: number;
  unsentCount: number;
  sentCount: number;
}

export interface CheckLine {
  id: string;
  menuItemId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
  note: string | null;
  station: string;
  state: 'UNSENT' | 'SENT' | 'VOID' | string;
  batch: number | null;
  sentAt: string | null;
  sentByName: string | null;
  voidReason: string | null;
}

export interface CheckView extends FloorCheck {
  note: string | null;
  customerId: string | null;
  sendCount: number;
  preBillCount: number;
  changedAfterPrebill: boolean;
  voidedCents: number;
  lines: CheckLine[];
}

/** Restaurants, quán ăn and cafés get the table till; everyone else the salon till. */
export const isTableIndustry = (k: string | null | undefined) => k === 'RESTAURANT' || k === 'FAST_FOOD' || k === 'CAFE';

/** The colour story of a table, in the order a server cares about. */
export function tableState(check: Pick<FloorCheck, 'status' | 'itemCount' | 'unsentCount' | 'preBilledAt'> | null | undefined): TableState {
  if (!check) return 'free';
  if (check.status === 'PAYING') return 'paying';
  if (check.unsentCount > 0) return 'unsent';
  if (check.preBilledAt) return 'prebilled';
  if (check.itemCount > 0) return 'ordered';
  return 'seated';
}

/** Whole minutes since the table was opened (never negative). */
export function minutesOpen(openedAt: string | Date, now: Date = new Date()): number {
  const t = typeof openedAt === 'string' ? Date.parse(openedAt) : openedAt.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

/** ok → warn (yellow) → late (red), at the restaurant's own minutes. */
export function timerTone(mins: number, warn = 60, late = 90): 'ok' | 'warn' | 'late' {
  if (mins >= late) return 'late';
  if (mins >= warn) return 'warn';
  return 'ok';
}

/** The bill's lines as the screen shows them: sent rounds first (oldest first), then what is still being typed. */
export function lineGroups(lines: CheckLine[]): { key: string; batch: number | null; sentAt: string | null; by: string | null; lines: CheckLine[] }[] {
  const sent = new Map<number, CheckLine[]>();
  const unsent: CheckLine[] = [];
  for (const l of lines) {
    if (l.state === 'UNSENT') { unsent.push(l); continue; }
    const b = l.batch ?? 0;
    sent.set(b, [...(sent.get(b) ?? []), l]);
  }
  const out = [...sent.entries()].sort((a, b) => a[0] - b[0]).map(([b, ls]) => {
    const first = ls.find((l) => l.state === 'SENT') ?? ls[0];
    return { key: `b${b}`, batch: b || null, sentAt: first.sentAt, by: first.sentByName, lines: ls };
  });
  if (unsent.length) out.push({ key: 'unsent', batch: null, sentAt: null, by: null, lines: unsent });
  return out;
}

/** What a refusal from the table endpoints means, in the cashier's language. */
export function tillError(message: string | null | undefined, vi: boolean): string {
  const m = String(message ?? '');
  const say = (v: string, e: string) => (vi ? v : e);
  if (m.startsWith('TABLE_BUSY')) return say('Bàn này đang có bill. Mở bill đó thay vì mở mới.', 'That table already has a bill open.');
  if (m === 'UNSENT_LINES') return say('Còn món chưa báo bếp.', 'Some dishes have not been sent to the kitchen.');
  if (m === 'LINE_SENT') return say('Món đã báo bếp, không sửa được. Muốn bỏ thì huỷ món (cần lý do).', 'That dish is already with the kitchen. Cancel it instead (a reason is needed).');
  if (m === 'VOID_REASON_REQUIRED') return say('Cần ghi lý do huỷ.', 'A reason is required.');
  if (m === 'CHECK_PAYING') return say('Bill đang được thanh toán ở máy khác.', 'This bill is being paid on another device.');
  if (m === 'CHECK_CLOSED') return say('Bill đã đóng.', 'This bill is closed.');
  if (m === 'EMPTY_CHECK') return say('Bill chưa có món.', 'The bill has no dishes.');
  if (m === 'SHIFT_REQUIRED') return say('Chưa mở ca thu ngân. Mở ca rồi thu tiền.', 'Open a cashier shift before taking payment.');
  if (m.startsWith('APPROVAL_PIN_REQUIRED')) return say('Cần PIN của chủ tiệm hoặc quản lý.', 'A manager PIN is required.');
  if (m === 'LINE_CHANGED') return say('Món vừa được người khác sửa. Tải lại bill.', 'Someone just changed that dish. Reload the bill.');
  return m || say('Có lỗi, thử lại.', 'Something went wrong, try again.');
}

/** Quick cash notes for the change screen: exact, then the next round notes. */
export function cashQuickAmounts(totalCents: number, currency: string): number[] {
  const vnd = String(currency).toUpperCase() === 'VND';
  const steps = vnd ? [10000, 50000, 100000, 200000, 500000] : [100, 500, 1000, 2000, 5000, 10000];
  const out = new Set<number>([totalCents]);
  for (const s of steps) {
    const up = Math.ceil(totalCents / s) * s;
    if (up > totalCents) out.add(up);
    if (out.size >= 5) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
