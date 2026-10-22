/**
 * The restaurant till's small rules, kept out of the component so they are
 * tested: what colour a table is, how long it has been seated, which industry
 * gets the table till, the order tables are listed in, and what a server
 * refusal means in the cashier's own language.
 */

export type TableState = 'free' | 'seated' | 'ordered' | 'unsent' | 'prebilled' | 'askpay' | 'paying';

export interface FloorCheck {
  id: string;
  number: number;
  status: string;
  tableIds: string[];
  takeaway?: boolean;
  tables: string;
  guests: number;
  serverName: string | null;
  openedAt: string;
  preBilledAt: string | null;
  payRequestedAt?: string | null;
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
  options?: string[];
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

export interface OptionChoice { id: string; name: string; priceCents: number }
export interface OptionGroup { id: string; name: string; required: boolean; max: number; choices: OptionChoice[] }

/** Restaurants, quán ăn and cafés get the table till; everyone else the salon till. */
export const isTableIndustry = (k: string | null | undefined) => k === 'RESTAURANT' || k === 'FAST_FOOD' || k === 'CAFE';

const RANK: Record<TableState, number> = { free: 0, seated: 1, ordered: 2, prebilled: 3, paying: 4, askpay: 5, unsent: 6 };

/** The colour story of a table, in the order a server cares about. */
export function tableState(check: Pick<FloorCheck, 'status' | 'itemCount' | 'unsentCount' | 'preBilledAt'> & { payRequestedAt?: string | null } | null | undefined): TableState {
  if (!check) return 'free';
  if (check.status === 'PAYING') return 'paying';
  if (check.unsentCount > 0) return 'unsent';
  if (check.payRequestedAt) return 'askpay';
  if (check.preBilledAt) return 'prebilled';
  if (check.itemCount > 0) return 'ordered';
  return 'seated';
}

/** A table carrying several bills (after a split) shows the most urgent one. */
export function combinedState(checks: Parameters<typeof tableState>[0][]): TableState {
  return checks.map(tableState).reduce<TableState>((a, b) => (RANK[b] > RANK[a] ? b : a), 'free');
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

/** "M2" before "M10": tables are listed the way people count them. */
export function byTableName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
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

/** Can the picked options go to the kitchen? Every required group answered, none over its maximum. */
export function optionsReady(groups: OptionGroup[], picked: Record<string, string[]>): boolean {
  return groups.every((g) => {
    const n = (picked[g.id] ?? []).length;
    return (!g.required || n > 0) && n <= g.max;
  });
}

/** The price of a dish with the picked options. */
export function priceWith(base: number, groups: OptionGroup[], picked: Record<string, string[]>): number {
  let extra = 0;
  for (const g of groups) for (const id of picked[g.id] ?? []) extra += g.choices.find((c) => c.id === id)?.priceCents ?? 0;
  return base + extra;
}

/** Even split: N shares that add up exactly to the total (the first ones carry the remainder). */
export function evenShares(totalCents: number, n: number): number[] {
  const k = Math.max(1, Math.min(20, Math.round(n)));
  const base = Math.floor(totalCents / k);
  const rest = totalCents - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
}

const VI: Record<string, string> = {
  UNSENT_LINES: 'Còn món chưa báo bếp.',
  LINE_SENT: 'Món đã báo bếp, không sửa được. Muốn bỏ thì huỷ món (cần lý do).',
  LINE_NOT_SENT: 'Món chưa báo bếp: chỉ cần xoá, không phải huỷ.',
  LINE_VOID: 'Món này đã huỷ rồi.',
  LINE_CHANGED: 'Món vừa được người khác sửa. Tải lại bill.',
  VOID_REASON_REQUIRED: 'Cần ghi lý do huỷ.',
  CHECK_PAYING: 'Bill đang được thanh toán ở máy khác.',
  CHECK_CLOSED: 'Bill đã đóng.',
  CHECK_NOT_FOUND: 'Không tìm thấy bill này (có thể đã đóng hoặc đã gộp).',
  TABLE_NOT_FOUND: 'Không tìm thấy bàn.',
  TABLE_REQUIRED: 'Chọn ít nhất một bàn.',
  TOO_MANY_TABLES: 'Tối đa 6 bàn cho một bill.',
  DISH_NOT_FOUND: 'Món này không còn trong thực đơn.',
  LINE_NOT_FOUND: 'Không tìm thấy món trên bill.',
  CUSTOMER_NOT_FOUND: 'Không tìm thấy khách.',
  PRINT_NOT_FOUND: 'Không tìm thấy phiếu in.',
  EMPTY_CHECK: 'Bill chưa có món.',
  SHIFT_REQUIRED: 'Chưa mở ca thu ngân. Mở ca rồi thu tiền.',
  SOLD_OUT: 'Món này đã hết.',
  OPTION_UNKNOWN: 'Tuỳ chọn không còn trong thực đơn, chọn lại.',
  PAY_NOT_ALLOWED: 'Bạn không được thu tiền. Bấm “Yêu cầu thanh toán” để báo thu ngân.',
  DISCOUNT_NOT_ALLOWED: 'Bạn không có quyền giảm giá. Nhờ chủ tiệm hoặc quản lý.',
  MERGE_SAME: 'Chọn một bill khác để gộp.',
  SPLIT_EMPTY: 'Chọn ít nhất một món để tách.',
  SPLIT_ALL: 'Phải để lại ít nhất một món trên bill cũ.',
  BAD_QUANTITY: 'Số lượng không hợp lệ.',
  BAD_GUESTS: 'Số khách 1–99.',
  TENDER_REQUIRED: 'Chọn cách thanh toán.',
  NOT_PAID: 'Chưa thu đủ tiền.',
  NO_TENANT: 'Tài khoản chưa gắn với tiệm nào.',
  'Tendered amount is less than the amount due': 'Số tiền khách đưa ít hơn số phải thu.',
};
const EN: Record<string, string> = {
  UNSENT_LINES: 'Some dishes have not been sent to the kitchen.',
  LINE_SENT: 'That dish is already with the kitchen. Cancel it instead (a reason is needed).',
  LINE_NOT_SENT: 'That dish was never sent: just remove it.',
  LINE_VOID: 'That dish is already cancelled.',
  LINE_CHANGED: 'Someone just changed that dish. Reload the bill.',
  VOID_REASON_REQUIRED: 'A reason is required.',
  CHECK_PAYING: 'This bill is being paid on another device.',
  CHECK_CLOSED: 'This bill is closed.',
  CHECK_NOT_FOUND: 'Bill not found (it may be closed or merged).',
  TABLE_NOT_FOUND: 'Table not found.',
  TABLE_REQUIRED: 'Pick at least one table.',
  TOO_MANY_TABLES: 'At most 6 tables per bill.',
  DISH_NOT_FOUND: 'That dish is no longer on the menu.',
  LINE_NOT_FOUND: 'That line is not on the bill.',
  CUSTOMER_NOT_FOUND: 'Customer not found.',
  PRINT_NOT_FOUND: 'Print job not found.',
  EMPTY_CHECK: 'The bill has no dishes.',
  SHIFT_REQUIRED: 'Open a cashier shift before taking payment.',
  SOLD_OUT: 'That dish is sold out.',
  OPTION_UNKNOWN: 'That option is gone from the menu; pick again.',
  PAY_NOT_ALLOWED: 'You cannot take payment. Tap “Ask to pay” to tell the cashier.',
  DISCOUNT_NOT_ALLOWED: 'You cannot give a discount. Ask the owner or a manager.',
  MERGE_SAME: 'Pick another bill to merge.',
  SPLIT_EMPTY: 'Pick at least one dish to split.',
  SPLIT_ALL: 'Leave at least one dish on the original bill.',
  BAD_QUANTITY: 'Invalid quantity.',
  BAD_GUESTS: 'Guests 1–99.',
  TENDER_REQUIRED: 'Pick a payment method.',
  NOT_PAID: 'Not fully paid.',
  NO_TENANT: 'This account is not linked to a business.',
};

/** What a refusal from the table endpoints means, in the cashier's language. */
export function tillError(message: string | null | undefined, vi: boolean): string {
  const m = String(message ?? '').trim();
  const table = vi ? VI : EN;
  if (m.startsWith('TABLE_BUSY')) return vi ? 'Bàn này đang có bill. Mở bill đó thay vì mở mới.' : 'That table already has a bill open.';
  if (m.startsWith('APPROVAL_PIN_REQUIRED')) return vi ? 'Cần PIN của chủ tiệm hoặc quản lý.' : 'A manager PIN is required.';
  if (m.startsWith('OPTION_REQUIRED:')) return vi ? `Chọn “${m.slice(16)}” trước.` : `Pick “${m.slice(16)}” first.`;
  if (m.startsWith('OPTION_TOO_MANY:')) return vi ? `“${m.slice(16)}”: chọn quá số cho phép.` : `“${m.slice(16)}”: too many picked.`;
  if (table[m]) return table[m];
  if (!m) return vi ? 'Có lỗi, thử lại.' : 'Something went wrong, try again.';
  // A validation message from the server is English; a Vietnamese till says it plainly instead.
  if (vi && /^[\x00-\x7F]+$/.test(m) && /\b(must|should|not|invalid|failed|error|cannot|required)\b/i.test(m)) return 'Dữ liệu không hợp lệ, thử lại.';
  return m;
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
