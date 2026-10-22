/**
 * The restaurant till's small rules, kept out of the component so they are
 * tested: what colour a table is, how long it has been seated, which industry
 * gets the table till, the order tables are listed in, and what a server
 * refusal means in the cashier's own language.
 */

export type TableState = 'free' | 'seated' | 'ordered' | 'unsent' | 'prebilled' | 'askpay' | 'paying' | 'call';

/** Why a guest pressed the button on the table QR. */
export type CallReason = 'staff' | 'bill' | 'water' | 'cutlery';

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
  /** A guest pressed "call staff" (or the bill, water…) on the table QR. */
  callReason?: CallReason | string | null;
  callAt?: string | null;
  /** Money the bank feed matched to this bill. */
  bankPaidCents?: number;
  subtotalCents: number;
  itemCount: number;
  unsentCount: number;
  sentCount: number;
  /** Unsent dishes kept back (fired later); not counted in unsentCount. */
  heldCount?: number;
  /** Dishes a guest ordered by QR that staff have not accepted yet. */
  pendingCount?: number;
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
  state: 'UNSENT' | 'SENT' | 'VOID' | 'PENDING' | string;
  batch: number | null;
  sentAt: string | null;
  sentByName: string | null;
  voidReason: string | null;
  /** Unsent and kept back until "fire". */
  held?: boolean;
  /** The kitchen marked it done. */
  readyAt?: string | null;
  /** 'QR' when a guest ordered it from the table. */
  source?: string | null;
}

export interface CheckView extends FloorCheck {
  note: string | null;
  customerId: string | null;
  sendCount: number;
  preBillCount: number;
  changedAfterPrebill: boolean;
  voidedCents: number;
  lines: CheckLine[];
  serviceChargePercent?: number;
  serviceCents?: number;
  /** Dishes + service charge (what the bank QR asks for, before the till's own tax). */
  billCents?: number;
  vatPercent?: number;
  vatIncluded?: boolean;
  vatCents?: number;
  /** The code a bank transfer carries so the feed can match it (LM57). */
  payCode?: string;
  bankPaidAt?: string | null;
  invoiceInfo?: InvoiceInfo | null;
  qrUrl?: string | null;
}

export interface InvoiceInfo { company: string; taxCode: string; address: string; email: string }
export interface BankAccount { bin: string; accountNo: string; accountName: string }

export interface OptionChoice { id: string; name: string; priceCents: number }
export interface OptionGroup { id: string; name: string; required: boolean; max: number; choices: OptionChoice[] }

/** Restaurants, quán ăn and cafés get the table till; everyone else the salon till. */
export const isTableIndustry = (k: string | null | undefined) => k === 'RESTAURANT' || k === 'FAST_FOOD' || k === 'CAFE';

const RANK: Record<TableState, number> = { free: 0, seated: 1, ordered: 2, prebilled: 3, paying: 4, askpay: 5, unsent: 6, call: 7 };

/** The colour story of a table, in the order a server cares about. */
export function tableState(check: Pick<FloorCheck, 'status' | 'itemCount' | 'unsentCount' | 'preBilledAt'> & { payRequestedAt?: string | null; callReason?: string | null; pendingCount?: number } | null | undefined): TableState {
  if (!check) return 'free';
  if (check.status === 'PAYING') return 'paying';
  // A guest waiting on staff (QR dishes to accept, a call button) beats everything else.
  if ((check.pendingCount ?? 0) > 0 || check.callReason) return 'call';
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
    if (l.state === 'PENDING') continue; // the guests' QR dishes have their own box
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

/** The QR dishes a guest sent that staff have not accepted yet. */
export function pendingLines(lines: CheckLine[]): CheckLine[] {
  return lines.filter((l) => l.state === 'PENDING');
}

/** What the guest's button means, in the staff's words. */
export function callText(reason: string | null | undefined, vi: boolean): string {
  switch (reason) {
    case 'bill': return vi ? 'Khách xin thanh toán' : 'Guest wants the bill';
    case 'water': return vi ? 'Khách xin thêm nước' : 'Guest wants water';
    case 'cutlery': return vi ? 'Khách xin chén đũa' : 'Guest wants cutlery';
    default: return vi ? 'Khách gọi nhân viên' : 'Guest is calling';
  }
}

/** Money as the restaurant writes it (₫ has no decimals; dollars do). */
const MONEY_LOCALE: Record<string, string> = { USD: 'en-US', CAD: 'en-CA', VND: 'vi-VN', AUD: 'en-AU', GBP: 'en-GB', EUR: 'de-DE' };
export function formatMoney(cents: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    const nf = new Intl.NumberFormat(MONEY_LOCALE[code] ?? 'en-US', { style: 'currency', currency: code });
    const zero = nf.resolvedOptions().maximumFractionDigits === 0;
    return nf.format(zero ? cents : cents / 100);
  } catch { return String(cents); }
}

/**
 * A VietQR for exactly what is still owed, carrying the bill code so the bank
 * feed can match it. Only for đồng (VietQR is a Vietnamese standard) and only
 * with a usable account; otherwise null and the till shows its static QR.
 */
export function vietQr(bank: BankAccount | null | undefined, amount: number, code: string, currency: string): string | null {
  if (!bank || String(currency).toUpperCase() !== 'VND') return null;
  if (!/^\d{6}$/.test(bank.bin) || !/^[0-9A-Za-z]{4,24}$/.test(bank.accountNo)) return null;
  const q = new URLSearchParams({ amount: String(Math.max(0, Math.round(amount))), addInfo: code, ...(bank.accountName ? { accountName: bank.accountName } : {}) });
  return `https://img.vietqr.io/image/${bank.bin}-${bank.accountNo}-compact2.png?${q.toString()}`;
}

/** Banks people in Vietnam actually use, with their NAPAS BIN (what VietQR needs). */
export const VN_BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' }, { bin: '970415', name: 'VietinBank' }, { bin: '970418', name: 'BIDV' }, { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' }, { bin: '970422', name: 'MB Bank' }, { bin: '970416', name: 'ACB' }, { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' }, { bin: '970403', name: 'Sacombank' }, { bin: '970441', name: 'VIB' }, { bin: '970437', name: 'HDBank' },
  { bin: '970443', name: 'SHB' }, { bin: '970448', name: 'OCB' }, { bin: '970426', name: 'MSB' }, { bin: '970440', name: 'SeABank' },
  { bin: '970431', name: 'Eximbank' }, { bin: '970449', name: 'LPBank' }, { bin: '970428', name: 'Nam A Bank' }, { bin: '970409', name: 'Bac A Bank' },
];

/** Account names go on VietQR in capitals without accents (what banks print). */
export function bankName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
}

/** A kitchen ticket's age, and when it gets yellow / red (default 10 / 15 minutes). */
export function ticketTone(sentAt: string | null | undefined, now: Date = new Date(), late = 15): { mins: number; tone: 'ok' | 'warn' | 'late' } {
  const mins = sentAt ? minutesOpen(sentAt, now) : 0;
  return { mins, tone: timerTone(mins, Math.max(1, Math.round((late * 2) / 3)), late) };
}

// ---- the guest's cart on the table QR page ----------------------------------------

export interface CartLine { key: string; menuItemId: string; name: string; unitPriceCents: number; quantity: number; options: { groupId: string; choiceIds: string[] }[]; optionNames: string[]; note: string }

/** Same dish with the same options and note = one line with a bigger quantity. */
export function cartKey(menuItemId: string, options: { groupId: string; choiceIds: string[] }[], note = ''): string {
  const o = options.filter((x) => x.choiceIds.length).map((x) => `${x.groupId}:${[...x.choiceIds].sort().join(',')}`).sort().join('|');
  return `${menuItemId}#${o}#${note.trim().toLowerCase()}`;
}

export function addToCart(cart: CartLine[], line: Omit<CartLine, 'key'>): CartLine[] {
  const key = cartKey(line.menuItemId, line.options, line.note);
  const hit = cart.find((c) => c.key === key);
  if (hit) return cart.map((c) => (c.key === key ? { ...c, quantity: Math.min(20, c.quantity + line.quantity) } : c));
  return [...cart, { ...line, key, quantity: Math.min(20, line.quantity) }].slice(0, 30);
}

export function cartTotal(cart: CartLine[]): { count: number; cents: number } {
  return cart.reduce((a, c) => ({ count: a.count + c.quantity, cents: a.cents + c.quantity * c.unitPriceCents }), { count: 0, cents: 0 });
}

/** What the server takes: ids, quantities, options, notes. Never names or prices. */
export function cartToOrder(cart: CartLine[]): { menuItemId: string; quantity: number; options: { groupId: string; choiceIds: string[] }[]; note?: string }[] {
  return cart.filter((c) => c.quantity > 0).map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, options: c.options.filter((o) => o.choiceIds.length), ...(c.note.trim() ? { note: c.note.trim() } : {}) }));
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
  QR_PENDING: 'Bàn còn món khách gọi qua QR chưa xác nhận. Nhận hoặc từ chối trước khi thu tiền.',
  QR_OFF: 'Nhà hàng chưa bật gọi món qua QR.',
  QR_TOO_MANY: 'Bàn đã có quá nhiều món chờ xác nhận.',
  EMPTY_ORDER: 'Chưa chọn món nào.',
  LINE_REQUIRED: 'Chọn ít nhất một món.',
  BAD_SECRET: 'Khoá kết nối ngân hàng không đúng.',
  HOOK_NOT_FOUND: 'Không tìm thấy kết nối ngân hàng.',
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
  QR_PENDING: 'Guests ordered by QR and nobody accepted it yet. Accept or reject before taking payment.',
  QR_OFF: 'QR ordering is turned off.',
  QR_TOO_MANY: 'Too many dishes are waiting to be accepted.',
  EMPTY_ORDER: 'Nothing picked yet.',
  LINE_REQUIRED: 'Pick at least one dish.',
  BAD_SECRET: 'Wrong bank feed secret.',
  HOOK_NOT_FOUND: 'Bank feed not found.',
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
