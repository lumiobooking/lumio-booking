/**
 * Thu & Chi — the shapes the API sends (apps/api/src/finance) and the few
 * words every finance screen shares. Labels for computed lines are chosen
 * here from the line's source, so a Texas salon reads English and a Saigon
 * salon reads Vietnamese whatever the server wrote.
 */

export type Direction = 'IN' | 'OUT';
export type CatGroup = 'INCOME' | 'COGS' | 'STAFF' | 'OPS' | 'MARKETING' | 'OTHER' | 'NON_PL';
export type LineSource = 'SALES' | 'REFUND' | 'DRAWER' | 'SHIFT_DIFF' | 'MANUAL' | 'TRANSFER' | 'PAYROLL' | 'STOCK' | 'RECURRING';

export interface Fund {
  id: string; kind: 'CASH' | 'BANK' | 'OTHER'; name: string; last4: string | null;
  openingCents: number; openingDate: string; isDefault: boolean; archived: boolean; balanceCents: number;
}

export interface Category {
  id: string; direction: Direction; group: CatGroup; name: string; countsInPl: boolean;
  systemKey: string | null; system: boolean; budgetCents: number | null; hidden: boolean;
}

export interface Line {
  id: string; day: string; at: string; fundId: string; direction: Direction; amountCents: number;
  source: LineSource; categoryId: string | null; countsInPl: boolean; label: string;
  detail?: string | null; payee?: string | null; note?: string | null; code?: string | null;
  locked: boolean; needsReview?: boolean;
  ref?: { kind: 'salesDay' | 'order' | 'shift' | 'payroll' | 'stock' | 'recurring' | 'entry'; id: string; count?: number } | null;
  transferId?: string | null; receiptUrl?: string | null; createdByName?: string | null;
  voided?: { at: string; by: string | null; reason: string | null } | null;
  balanceCents: number | null;
}

export interface Ledger {
  from: string; to: string; fundId: string | null; today: string;
  openingCents: number; inCents: number; outCents: number; closingCents: number; transferCents: number;
  funds: { id: string; openingCents: number; inCents: number; outCents: number; closingCents: number }[];
  lines: Line[];
  days: { day: string; inCents: number; outCents: number }[];
  fundList: Fund[];
  categories: Category[];
}

export interface PnlRow { key: string; label: string; cents: number; source: string; categoryId?: string | null; budgetCents?: number | null }
export interface PnlSection { group: CatGroup; label: string; rows: PnlRow[]; totalCents: number }
export interface Pnl {
  revenue: { grossCents: number; discountCents: number; refundCents: number; netCents: number };
  otherIncome: PnlSection; incomeCents: number; expenses: PnlSection[]; expenseCents: number; profitCents: number;
  marginBp: number | null;
  outside: { tipsCents: number; taxCents: number; nonPlInCents: number; nonPlOutCents: number };
  unreviewedCents: number;
}
export interface PnlResponse { from: string; to: string; current: Pnl; previous: Pnl | null; compare: { from: string; to: string } | null; categories: Category[] }
export interface TrendPoint { month: string; from: string; to: string; netSalesCents: number; incomeCents: number; expenseCents: number; profitCents: number }

export interface Pending {
  today: string;
  payroll: { runId: string; periodFrom: string; periodTo: string; netPayCents: number; cashCents: number; bankCents: number }[];
  stock: { movementId: string; at: string; item: string; supplier: string | null; qty: number; unitCostCents: number; amountCents: number }[];
  recurring: { id: string; name: string; nextDue: string; amountCents: number | null; overdue: boolean; categoryId: string; fundId: string }[];
  drawerToReview: { count: number; cents: number };
}

export interface Recurring {
  id: string; name: string; categoryId: string; fundId: string; amountCents: number | null;
  cadence: 'WEEKLY' | 'MONTHLY' | 'YEARLY'; anchorDay: string; nextDue: string; mode: 'REMIND' | 'AUTO'; payee: string | null; active: boolean;
}

export type Tr = (vi: string, en: string) => string;

/** What opens the voucher form: a new one (direction only) or one to correct. */
export interface EntryInit {
  id?: string; direction: Direction; amountCents?: number; fundId?: string; categoryId?: string | null;
  day?: string; payee?: string | null; note?: string | null; countsInPl?: boolean;
}

/** What every Thu & Chi view gets from the page. */
export interface FinanceCtx {
  token: string | null;
  L: Tr;
  vi: boolean;
  currency: string;
  today: string;
  funds: Fund[];
  categories: Category[];
  approvalOverCents: number;
  isOwner: boolean;
  canSelfApprove: boolean;
  /** Bumped after any write so every view reloads. */
  version: number;
  refresh: () => void;
  openEntry: (init: EntryInit) => void;
}

export const groupLabel = (g: CatGroup, L: Tr): string => ({
  INCOME: L('Thu nhập', 'Income'),
  COGS: L('Giá vốn', 'Cost of services'),
  STAFF: L('Nhân sự', 'Staff'),
  OPS: L('Vận hành', 'Running the salon'),
  MARKETING: L('Marketing', 'Marketing'),
  OTHER: L('Khác', 'Other'),
  NON_PL: L('Ngoài lãi lỗ', 'Not on profit & loss'),
}[g]);

/** The words for a cash-book line: the category's own name when it has one. */
export function lineLabel(l: Line, catName: (id: string | null) => string | null, L: Tr): string {
  switch (l.source) {
    case 'SALES': return L('Thu bán hàng', 'Sales');
    case 'REFUND': return l.id.startsWith('pay:') ? L('Hoàn tiền một phần', 'Part refund') : L('Hoàn tiền bill', 'Bill refund');
    case 'SHIFT_DIFF': return l.direction === 'IN' ? L('Thừa tiền mặt khi chốt ca', 'Cash over at shift close') : L('Thiếu tiền mặt khi chốt ca', 'Cash short at shift close');
    case 'DRAWER': return catName(l.categoryId) ?? (l.direction === 'IN' ? L('Bỏ tiền vào ngăn kéo · chưa phân loại', 'Cash into drawer · unclassified') : L('Chi từ ngăn kéo · chưa phân loại', 'Cash out of drawer · unclassified'));
    case 'TRANSFER':
      if (l.id.startsWith('mv:')) return l.direction === 'OUT' ? L('Nộp tiền mặt vào ngân hàng', 'Cash taken to the bank') : L('Tiền mặt nộp từ ngăn kéo', 'Cash banked from the drawer');
      return l.direction === 'OUT' ? L('Chuyển quỹ đi', 'Transfer out') : L('Nhận chuyển quỹ', 'Transfer in');
    case 'PAYROLL': return L('Trả lương (gồm tip)', 'Payroll paid (incl. tips)');
    case 'STOCK': return L('Trả tiền nhập kho', 'Stock purchase paid');
    default: return catName(l.categoryId) ?? (l.direction === 'IN' ? L('Phiếu thu', 'Receipt') : L('Phiếu chi', 'Payment'));
  }
}

export function sourceLabel(s: LineSource, L: Tr): string {
  return ({
    SALES: L('Đơn hàng', 'Sales'), REFUND: L('Đơn hàng', 'Sales'), DRAWER: L('Ca thu ngân', 'Cashier shift'),
    SHIFT_DIFF: L('Chốt ca', 'Shift close'), MANUAL: L('Gõ tay', 'Typed'), TRANSFER: L('Chuyển quỹ', 'Transfer'),
    PAYROLL: L('Lương', 'Payroll'), STOCK: L('Kho', 'Inventory'), RECURRING: L('Định kỳ', 'Recurring'),
  } as Record<LineSource, string>)[s];
}

/** P&L rows the server computes (not a category): their name in the reader's language. */
export function pnlRowLabel(r: PnlRow, L: Tr): string {
  switch (r.key) {
    case 'payroll': return L('Lương, hoa hồng thợ (kỳ lương đã chốt)', 'Staff pay & commission (closed payroll)');
    case 'tip_fee': return L('Phí tip thẻ giữ lại', 'Card-tip fee kept');
    case 'supplies_stock': return L('Vật tư nhập kho (Kho)', 'Supplies bought in (Inventory)');
    case 'cash_over': return L('Thừa tiền mặt khi chốt ca', 'Cash over at shift close');
    case 'cash_short': return L('Thiếu tiền mặt khi chốt ca', 'Cash short at shift close');
    case 'unclassified_out': return L('Chi ngăn kéo chưa phân loại', 'Unclassified drawer cash out');
    case 'unclassified_in': return L('Thu chưa phân loại', 'Unclassified money in');
    default: return r.label;
  }
}

export const fundLabel = (f: Fund | undefined, L: Tr): string => {
  if (!f) return '—';
  const base = f.kind === 'CASH' && /^(Tiền mặt \(két\)|Cash drawer)$/.test(f.name) ? L('Tiền mặt (két)', 'Cash drawer') : f.name;
  return f.last4 ? `${base} ••${f.last4}` : base;
};

/** "1234" from a 403 message the API sends when a second person's PIN is needed. */
export const needsPin = (msg: string) => /APPROVAL_PIN_REQUIRED|PIN/.test(msg);

export const cleanErr = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^(Bad Request|Forbidden)( Exception)?:?\s*/i, '').replace(/^APPROVAL_PIN_REQUIRED:\s*/, '');
