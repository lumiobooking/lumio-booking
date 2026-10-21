/**
 * Thu & Chi — the arithmetic, with no database in it.
 *
 * TWO QUESTIONS, ONE SET OF FACTS
 *
 *   Sổ quỹ (cash book)  — where is the money, really? Every movement of real
 *                         money into or out of a fund, on the day it moved.
 *   Lãi / lỗ (P&L)      — did the salon make money? Sales the way Reports
 *                         count them, minus what running the salon cost.
 *
 * Big systems (KiotViet, Sapo, QuickBooks) answer both from one list of
 * vouchers, and mark which vouchers belong on the P&L. So does this file.
 *
 * NOTHING IS COPIED
 *
 * A sale, a refund, a drawer movement or a shift's count is read from where it
 * lives (payments, order_refunds, cash_movements, cash_shifts) every time. A
 * copy would drift the first time a bill is voided; a read cannot. Only what
 * exists nowhere else is stored: vouchers typed by hand, transfers between
 * funds, payroll and stock purchases marked paid, recurring costs.
 *
 * WHAT IS NOT ON THE P&L, ON PURPOSE
 *
 *  · Sales and refunds lines: revenue comes from the sales summary (the same
 *    number Reports shows), which already nets refunds. Counting the cash lines
 *    too would count every bill twice.
 *  · Payroll paid: staff cost comes from the closed payroll runs themselves
 *    (earnings + adjustments, never tips), so the P&L equals the payroll screen
 *    whether or not anyone pressed "paid".
 *  · Stock paid: supplies cost comes from the inventory purchases.
 *  · Tips, sales tax, owner money, loans, transfers: they pass through the
 *    salon's hands but are not its income or cost.
 */

export type FundKind = 'CASH' | 'BANK' | 'OTHER';
export type Direction = 'IN' | 'OUT';
export type CatGroup = 'INCOME' | 'COGS' | 'STAFF' | 'OPS' | 'MARKETING' | 'OTHER' | 'NON_PL';
export type LineSource = 'SALES' | 'REFUND' | 'DRAWER' | 'SHIFT_DIFF' | 'MANUAL' | 'TRANSFER' | 'PAYROLL' | 'STOCK' | 'RECURRING';

export const GROUPS: CatGroup[] = ['INCOME', 'COGS', 'STAFF', 'OPS', 'MARKETING', 'OTHER', 'NON_PL'];

export interface DefaultCategory {
  key: string;
  direction: Direction;
  group: CatGroup;
  vi: string;
  en: string;
  countsInPl: boolean;
  /** Written by the system: name and P&L flag are locked. */
  system: boolean;
}

/** Every salon starts with these (seeded once, idempotently, by systemKey). */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // ---- in
  { key: 'sales', direction: 'IN', group: 'INCOME', vi: 'Thu bán hàng', en: 'Sales', countsInPl: false, system: true },
  { key: 'other_income', direction: 'IN', group: 'INCOME', vi: 'Thu khác', en: 'Other income', countsInPl: true, system: false },
  { key: 'drawer_in', direction: 'IN', group: 'NON_PL', vi: 'Bỏ thêm tiền vào ngăn kéo', en: 'Cash added to drawer', countsInPl: false, system: false },
  { key: 'owner_in', direction: 'IN', group: 'NON_PL', vi: 'Chủ góp vốn', en: 'Owner contribution', countsInPl: false, system: false },
  { key: 'loan_in', direction: 'IN', group: 'NON_PL', vi: 'Vay', en: 'Loan received', countsInPl: false, system: false },
  // ---- out: the system's own
  { key: 'refund', direction: 'OUT', group: 'NON_PL', vi: 'Hoàn tiền bill', en: 'Bill refunds', countsInPl: false, system: true },
  { key: 'payroll', direction: 'OUT', group: 'STAFF', vi: 'Trả lương (gồm tip)', en: 'Payroll paid (incl. tips)', countsInPl: false, system: true },
  { key: 'stock_paid', direction: 'OUT', group: 'COGS', vi: 'Trả tiền nhập kho', en: 'Stock purchase paid', countsInPl: false, system: true },
  // ---- out: the salon's costs
  { key: 'supplies', direction: 'OUT', group: 'COGS', vi: 'Vật tư làm móng', en: 'Salon supplies', countsInPl: true, system: false },
  { key: 'retail_stock', direction: 'OUT', group: 'COGS', vi: 'Nhập hàng bán lẻ', en: 'Retail stock', countsInPl: true, system: false },
  { key: 'rent', direction: 'OUT', group: 'OPS', vi: 'Thuê mặt bằng', en: 'Rent', countsInPl: true, system: false },
  { key: 'utilities', direction: 'OUT', group: 'OPS', vi: 'Điện, nước, internet', en: 'Utilities', countsInPl: true, system: false },
  { key: 'laundry', direction: 'OUT', group: 'OPS', vi: 'Giặt khăn, vệ sinh', en: 'Laundry & cleaning', countsInPl: true, system: false },
  { key: 'repairs', direction: 'OUT', group: 'OPS', vi: 'Sửa chữa, bảo trì', en: 'Repairs & maintenance', countsInPl: true, system: false },
  { key: 'software', direction: 'OUT', group: 'OPS', vi: 'Phần mềm', en: 'Software', countsInPl: true, system: false },
  { key: 'insurance', direction: 'OUT', group: 'OPS', vi: 'Bảo hiểm, giấy phép', en: 'Insurance & licenses', countsInPl: true, system: false },
  { key: 'card_fees', direction: 'OUT', group: 'OPS', vi: 'Phí quẹt thẻ, ngân hàng', en: 'Card & bank fees', countsInPl: true, system: false },
  { key: 'marketing', direction: 'OUT', group: 'MARKETING', vi: 'Quảng cáo', en: 'Advertising', countsInPl: true, system: false },
  { key: 'other_expense', direction: 'OUT', group: 'OTHER', vi: 'Chi khác', en: 'Other expense', countsInPl: true, system: false },
  { key: 'tips_out', direction: 'OUT', group: 'NON_PL', vi: 'Tip trả thợ', en: 'Tips paid to staff', countsInPl: false, system: false },
  { key: 'sales_tax', direction: 'OUT', group: 'NON_PL', vi: 'Nộp thuế bán hàng', en: 'Sales tax paid', countsInPl: false, system: false },
  { key: 'owner_out', direction: 'OUT', group: 'NON_PL', vi: 'Chủ rút vốn', en: 'Owner draw', countsInPl: false, system: false },
  { key: 'loan_out', direction: 'OUT', group: 'NON_PL', vi: 'Trả nợ vay', en: 'Loan repayment', countsInPl: false, system: false },
  { key: 'advance', direction: 'OUT', group: 'NON_PL', vi: 'Tạm ứng cho thợ', en: 'Staff advance', countsInPl: false, system: false },
  // From the drawer only: cash taken to the bank. The ledger books it as a
  // transfer (out of the drawer, into the default bank) — never a cost.
  { key: 'bank_deposit', direction: 'OUT', group: 'NON_PL', vi: 'Nộp tiền mặt vào ngân hàng', en: 'Cash taken to the bank', countsInPl: false, system: false },
];

/** Categories a person may not pick on a voucher (the system writes them, or there is a better tool). */
export function voucherBlocked(systemKey: string | null | undefined): 'system' | 'transfer' | null {
  if (!systemKey) return null;
  if (systemKey === 'bank_deposit') return 'transfer';
  return DEFAULT_CATEGORIES.some((c) => c.key === systemKey && c.system) ? 'system' : null;
}

// ---------------------------------------------------------------------------
// money in and out of a fund

export interface FundRow {
  id: string;
  kind: FundKind;
  name: string;
  openingCents: number;
  openingDate: string;
  isDefault: boolean;
  archived: boolean;
}

export interface LedgerLine {
  /** Stable across reads: 'sales:<day>:<fundId>', 'refund:<id>', 'mv:<id>', 'entry:<id>'… */
  id: string;
  day: string;
  at: string;
  fundId: string;
  direction: Direction;
  amountCents: number;
  source: LineSource;
  categoryId: string | null;
  countsInPl: boolean;
  label: string;
  detail?: string | null;
  payee?: string | null;
  note?: string | null;
  code?: string | null;
  /** Edit it where it was made (a bill, a shift, a payroll run). */
  locked: boolean;
  /** A drawer movement nobody has said the purpose of. */
  needsReview?: boolean;
  /** What to open for the detail. */
  ref?: { kind: 'salesDay' | 'order' | 'shift' | 'payroll' | 'stock' | 'recurring' | 'entry'; id: string; count?: number } | null;
  transferId?: string | null;
  receiptUrl?: string | null;
  createdByName?: string | null;
  voided?: { at: string; by: string | null; reason: string | null } | null;
}

/** Which fund a payment provider's money lands in: cash in the drawer, everything else in the bank. */
export function fundForProvider(provider: string | null | undefined, cashFundId: string, bankFundId: string): string {
  return provider === 'pos-cash' ? cashFundId : bankFundId;
}

/** A refund method (CASH, CARD, TRANSFER…) to its fund, the same way. */
export function fundForMethod(method: string | null | undefined, cashFundId: string, bankFundId: string): string {
  return String(method ?? '').toUpperCase() === 'CASH' ? cashFundId : bankFundId;
}

export interface PaymentRow { id: string; amountCents: number; provider: string | null; status: string; paidAt: Date; providerReference: string | null }

/**
 * Sales money, one line per salon day per fund (a busy day is fifty bills —
 * the line opens to them). Part refunds are their own lines.
 *
 *  · PAID and positive: money in, on the day it was paid.
 *  · PAID and negative: a part refund — money out, on that day.
 *  · REFUNDED (a whole bill refunded later): the money DID come in that day;
 *    it went back on the refund's own day, which is a separate line. Only
 *    counted when the caller confirms the bill was refunded, not voided — a
 *    voided bill never happened.
 */
export function salesLines(
  rows: PaymentRow[],
  dayOf: (d: Date) => string,
  cashFundId: string,
  bankFundId: string,
  fullyRefundedOrders: Set<string>,
): LedgerLine[] {
  const days = new Map<string, { day: string; fundId: string; cents: number; count: number; last: Date }>();
  const out: LedgerLine[] = [];
  for (const p of rows) {
    if (!p.amountCents) continue;
    const orderId = p.providerReference?.startsWith('order:') ? p.providerReference.slice(6) : null;
    if (p.status === 'REFUNDED') {
      if (!(p.amountCents > 0 && orderId && fullyRefundedOrders.has(orderId))) continue;
    } else if (p.status !== 'PAID') continue;
    const fundId = fundForProvider(p.provider, cashFundId, bankFundId);
    const day = dayOf(p.paidAt);
    if (p.amountCents < 0) {
      out.push({
        id: `pay:${p.id}`, day, at: p.paidAt.toISOString(), fundId, direction: 'OUT', amountCents: -p.amountCents,
        source: 'REFUND', categoryId: null, countsInPl: false, label: 'Hoàn tiền một phần', locked: true,
        ref: orderId ? { kind: 'order', id: orderId } : null,
      });
      continue;
    }
    const k = `${day}|${fundId}`;
    const g = days.get(k) ?? { day, fundId, cents: 0, count: 0, last: p.paidAt };
    g.cents += p.amountCents;
    g.count += 1;
    if (p.paidAt > g.last) g.last = p.paidAt;
    days.set(k, g);
  }
  for (const g of days.values()) {
    out.push({
      id: `sales:${g.day}:${g.fundId}`, day: g.day, at: g.last.toISOString(), fundId: g.fundId, direction: 'IN', amountCents: g.cents,
      source: 'SALES', categoryId: null, countsInPl: false, label: 'Thu bán hàng', locked: true,
      ref: { kind: 'salesDay', id: `${g.day}|${g.fundId}`, count: g.count },
    });
  }
  return out;
}

export interface FullRefundRow { id: string; orderId: string; orderNumber?: string | null; amountCents: number; method: string; reason: string | null; createdAt: Date }

export function refundLines(rows: FullRefundRow[], dayOf: (d: Date) => string, cashFundId: string, bankFundId: string): LedgerLine[] {
  return rows.filter((r) => r.amountCents > 0).map((r) => ({
    id: `refund:${r.id}`, day: dayOf(r.createdAt), at: r.createdAt.toISOString(),
    fundId: fundForMethod(r.method, cashFundId, bankFundId), direction: 'OUT' as Direction, amountCents: r.amountCents,
    source: 'REFUND' as LineSource, categoryId: null, countsInPl: false,
    label: `Hoàn tiền bill${r.orderNumber ? ` #${r.orderNumber}` : ''}`, detail: r.reason, locked: true,
    ref: { kind: 'order' as const, id: r.orderId },
  }));
}

export interface MovementRow { id: string; shiftId: string; kind: string; amountCents: number; reason: string | null; byName: string | null; createdAt: Date; categoryId: string | null; source: string | null }

/** A movement the refund screen wrote: already in the books as the refund itself. */
export function isRefundMovement(m: Pick<MovementRow, 'source' | 'reason'>): boolean {
  return m.source === 'refund' || (!m.source && /^Hoàn tiền bill #/.test(m.reason ?? ''));
}

/**
 * Cash put into or taken out of the drawer during a shift. Uncategorised ones
 * are flagged: an OUT counts as an expense until someone says otherwise (the
 * careful side — profit is not overstated), an IN does not count as income.
 */
export function drawerLines(
  rows: MovementRow[],
  dayOf: (d: Date) => string,
  cashFundId: string,
  bankFundId: string,
  catInfo: (categoryId: string) => { countsInPl: boolean; systemKey: string | null } | null,
): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const m of rows) {
    if (isRefundMovement(m) || !(m.amountCents > 0)) continue;
    const dir: Direction = m.kind === 'IN' ? 'IN' : 'OUT';
    const info = m.categoryId ? catInfo(m.categoryId) : null;
    // Cash banked from the drawer: the same money, now in the bank.
    if (info?.systemKey === 'bank_deposit' && dir === 'OUT') {
      const common = { day: dayOf(m.createdAt), at: m.createdAt.toISOString(), amountCents: m.amountCents, source: 'TRANSFER' as LineSource, categoryId: m.categoryId, countsInPl: false, detail: m.reason, createdByName: m.byName, locked: true, transferId: `mv:${m.id}`, ref: { kind: 'shift' as const, id: m.shiftId } };
      out.push({ ...common, id: `mv:${m.id}`, fundId: cashFundId, direction: 'OUT', label: 'Nộp tiền mặt vào ngân hàng' });
      out.push({ ...common, id: `mv:${m.id}:bank`, fundId: bankFundId, direction: 'IN', label: 'Tiền mặt nộp từ ngăn kéo' });
      continue;
    }
    const known = info ? info.countsInPl : null;
    const counts = known ?? (dir === 'OUT');
    out.push({
      id: `mv:${m.id}`, day: dayOf(m.createdAt), at: m.createdAt.toISOString(), fundId: cashFundId, direction: dir,
      amountCents: m.amountCents, source: 'DRAWER', categoryId: known === null ? null : m.categoryId, countsInPl: counts,
      label: dir === 'IN' ? 'Bỏ tiền vào ngăn kéo' : 'Chi từ ngăn kéo', detail: m.reason, createdByName: m.byName,
      locked: true, needsReview: known === null, ref: { kind: 'shift', id: m.shiftId },
    });
  }
  return out;
}

export interface ShiftRow { id: string; closedAt: Date; varianceCents: number; closedByName: string | null }

/** What the count found that the books did not expect: cash over (+) or short (−), on the P&L. */
export function shiftDiffLines(rows: ShiftRow[], dayOf: (d: Date) => string, cashFundId: string): LedgerLine[] {
  return rows.filter((s) => s.varianceCents).map((s) => ({
    id: `shift:${s.id}`, day: dayOf(s.closedAt), at: s.closedAt.toISOString(), fundId: cashFundId,
    direction: (s.varianceCents > 0 ? 'IN' : 'OUT') as Direction, amountCents: Math.abs(s.varianceCents),
    source: 'SHIFT_DIFF' as LineSource, categoryId: null, countsInPl: true,
    label: s.varianceCents > 0 ? 'Thừa tiền mặt khi chốt ca' : 'Thiếu tiền mặt khi chốt ca',
    createdByName: s.closedByName, locked: true, ref: { kind: 'shift' as const, id: s.id },
  }));
}

export interface EntryRow {
  id: string; code: string; direction: string; fundId: string; categoryId: string | null; amountCents: number; countsInPl: boolean;
  occurredAt: Date; day: string; payee: string | null; note: string | null; receiptUrl: string | null;
  source: string; sourceRef: string | null; transferId: string | null; createdByName: string | null;
  voidedAt: Date | null; voidedByName: string | null; voidReason: string | null;
}

type RefKind = NonNullable<LedgerLine['ref']>['kind'];

export function entryLines(rows: EntryRow[], catName: (id: string | null) => string | null): LedgerLine[] {
  return rows.map((e) => {
    const src = (['MANUAL', 'TRANSFER', 'PAYROLL', 'STOCK', 'RECURRING'].includes(e.source) ? e.source : 'MANUAL') as LineSource;
    const refKind = src === 'PAYROLL' ? 'payroll' : src === 'STOCK' ? 'stock' : src === 'RECURRING' ? 'recurring' : 'entry';
    const refId = src === 'PAYROLL' || src === 'STOCK' || src === 'RECURRING' ? String(e.sourceRef ?? '').split(':')[0] : e.id;
    return {
      id: `entry:${e.id}`, day: e.day, at: e.occurredAt.toISOString(), fundId: e.fundId,
      direction: (e.direction === 'IN' ? 'IN' : 'OUT') as Direction, amountCents: e.amountCents,
      source: src, categoryId: e.categoryId, countsInPl: src === 'TRANSFER' ? false : e.countsInPl,
      label: src === 'TRANSFER' ? (e.direction === 'IN' ? 'Nhận chuyển quỹ' : 'Chuyển quỹ đi') : (catName(e.categoryId) ?? (e.direction === 'IN' ? 'Phiếu thu' : 'Phiếu chi')),
      payee: e.payee, note: e.note, code: e.code, receiptUrl: e.receiptUrl, createdByName: e.createdByName,
      transferId: e.transferId, locked: src === 'PAYROLL' || src === 'STOCK',
      ref: { kind: refKind as RefKind, id: refId },
      voided: e.voidedAt ? { at: e.voidedAt.toISOString(), by: e.voidedByName, reason: e.voidReason } : null,
    } as LedgerLine;
  });
}

// ---------------------------------------------------------------------------
// the cash book

export interface LedgerResult {
  from: string;
  to: string;
  fundId: string | null;
  openingCents: number;
  inCents: number;
  outCents: number;
  closingCents: number;
  /** Money that only changed fund (shown, not counted, in the all-funds view). */
  transferCents: number;
  /** Per fund: balance at the start and end of the period. */
  funds: { id: string; openingCents: number; inCents: number; outCents: number; closingCents: number }[];
  /** Newest first, each with the balance right after it (of the fund shown, or of all funds). */
  lines: (LedgerLine & { balanceCents: number | null })[];
  days: { day: string; inCents: number; outCents: number }[];
}

const signed = (l: LedgerLine) => (l.direction === 'IN' ? l.amountCents : -l.amountCents);

/**
 * The cash book for [from, to], for one fund or all of them.
 *
 * A fund's books start on its opening day with its opening balance; nothing
 * dated earlier counts for it. Balance at the start of the period = opening +
 * every live line from the opening day to the day before `from`. Voided lines
 * are listed (crossed out) and never summed. In the all-funds view a transfer
 * moves nothing — it is listed, not counted as money in or out.
 */
export function assembleLedger(funds: FundRow[], allLines: LedgerLine[], from: string, to: string, fundId: string | null): LedgerResult {
  const fundMap = new Map(funds.map((f) => [f.id, f]));
  const usable = allLines.filter((l) => {
    const f = fundMap.get(l.fundId);
    return !!f && l.day >= f.openingDate && l.day <= to;
  });
  const perFund = funds.map((f) => {
    // Its books start after this period ends: nothing to show for it yet.
    if (f.openingDate > to) return { id: f.id, openingCents: 0, inCents: 0, outCents: 0, closingCents: 0 };
    const mine = usable.filter((l) => l.fundId === f.id && !l.voided);
    const before = mine.filter((l) => l.day < from).reduce((n, l) => n + signed(l), 0);
    const inside = mine.filter((l) => l.day >= from);
    const inC = inside.filter((l) => l.direction === 'IN').reduce((n, l) => n + l.amountCents, 0);
    const outC = inside.filter((l) => l.direction === 'OUT').reduce((n, l) => n + l.amountCents, 0);
    // A fund opened inside the period starts the period at zero and receives
    // its opening balance on its opening day — still part of "opening" here,
    // so opening + in − out = closing holds for every fund.
    const opening = f.openingCents + before;
    return { id: f.id, openingCents: opening, inCents: inC, outCents: outC, closingCents: opening + inC - outC };
  });
  const shownFunds = fundId ? perFund.filter((f) => f.id === fundId) : perFund;
  const openingCents = shownFunds.reduce((n, f) => n + f.openingCents, 0);
  const inPeriod = usable.filter((l) => l.day >= from && (!fundId || l.fundId === fundId));
  const live = inPeriod.filter((l) => !l.voided);
  const isTransfer = (l: LedgerLine) => l.source === 'TRANSFER';
  const counted = fundId ? live : live.filter((l) => !isTransfer(l));
  const inCents = counted.filter((l) => l.direction === 'IN').reduce((n, l) => n + l.amountCents, 0);
  const outCents = counted.filter((l) => l.direction === 'OUT').reduce((n, l) => n + l.amountCents, 0);
  const transferCents = fundId ? 0 : live.filter((l) => isTransfer(l) && l.direction === 'OUT').reduce((n, l) => n + l.amountCents, 0);
  // In the all-funds view a transfer's two halves cancel, so the closing
  // balance is the same with or without them.
  const closingCents = shownFunds.reduce((n, f) => n + f.closingCents, 0);

  // Running balance, oldest first, then newest first for the screen.
  const asc = [...inPeriod].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
  let run = openingCents;
  const withBal = asc.map((l) => {
    if (l.voided) return { ...l, balanceCents: null };
    run += signed(l);
    return { ...l, balanceCents: run };
  });
  const dayMap = new Map<string, { day: string; inCents: number; outCents: number }>();
  for (const l of counted) {
    const d = dayMap.get(l.day) ?? { day: l.day, inCents: 0, outCents: 0 };
    if (l.direction === 'IN') d.inCents += l.amountCents; else d.outCents += l.amountCents;
    dayMap.set(l.day, d);
  }
  return {
    from, to, fundId, openingCents, inCents, outCents, closingCents, transferCents,
    funds: perFund,
    lines: withBal.reverse(),
    days: [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day)),
  };
}

// ---------------------------------------------------------------------------
// profit & loss

export interface SalesFigures { grossCents: number; discountCents: number; refundCents: number; netCents: number; tipsCents: number; taxCents: number; serviceCents: number; productCents: number }
export interface PayrollFigures { runId: string; periodFrom: string; periodTo: string; earningsCents: number; adjustmentsCents: number; tipsNetCents: number; cardTipFeeCents: number; netPayCents: number }
export interface CategoryMeta { id: string; name: string; group: CatGroup; direction: Direction; systemKey: string | null; budgetCents: number | null }

export interface PnlRow { key: string; label: string; cents: number; source: 'sales' | 'payroll' | 'inventory' | 'vouchers' | 'drawer' | 'shift'; categoryId?: string | null; budgetCents?: number | null }
export interface PnlSection { group: CatGroup | 'REVENUE'; label: string; rows: PnlRow[]; totalCents: number }
export interface PnlResult {
  revenue: { grossCents: number; discountCents: number; refundCents: number; netCents: number };
  otherIncome: PnlSection;
  incomeCents: number;
  expenses: PnlSection[];
  expenseCents: number;
  profitCents: number;
  /** Profit ÷ net sales, in basis points (2770 = 27.7%); null without sales. */
  marginBp: number | null;
  /** Shown under the statement: real money that passed through, not income or cost. */
  outside: { tipsCents: number; taxCents: number; nonPlInCents: number; nonPlOutCents: number };
  /** Drawer money nobody has classified yet (counted as an expense meanwhile). */
  unreviewedCents: number;
}

const GROUP_LABEL: Record<CatGroup, string> = {
  INCOME: 'Thu nhập khác', COGS: 'Giá vốn', STAFF: 'Nhân sự', OPS: 'Vận hành', MARKETING: 'Marketing', OTHER: 'Khác', NON_PL: 'Ngoài lãi lỗ',
};

/**
 * The P&L for a period. `lines` are the period's cash-book lines (any fund);
 * only live ones with countsInPl are read. Sales come from the sales summary,
 * staff cost from closed payroll runs, supplies from inventory purchases.
 */
export function buildPnl(input: {
  sales: SalesFigures;
  payroll: PayrollFigures[];
  supplyPurchaseCents: number;
  lines: LedgerLine[];
  categories: CategoryMeta[];
}): PnlResult {
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const live = input.lines.filter((l) => !l.voided);
  const rows = new Map<string, PnlRow & { group: CatGroup }>();
  const add = (group: CatGroup, key: string, label: string, cents: number, source: PnlRow['source'], categoryId?: string | null, budgetCents?: number | null) => {
    if (!cents) return;
    const k = `${group}|${key}`;
    const r = rows.get(k) ?? { group, key, label, cents: 0, source, categoryId: categoryId ?? null, budgetCents: budgetCents ?? null };
    r.cents += cents;
    rows.set(k, r);
  };

  // Staff: what the closed runs earned the team, without the tips they passed on.
  const staff = input.payroll.reduce((n, p) => n + p.earningsCents + p.adjustmentsCents, 0);
  add('STAFF', 'payroll', 'Lương, hoa hồng thợ', staff, 'payroll');
  // The card fee the salon kept back from card tips offsets its own card costs.
  const tipFee = input.payroll.reduce((n, p) => n + p.cardTipFeeCents, 0);
  add('INCOME', 'tip_fee', 'Phí tip thẻ giữ lại', tipFee, 'payroll');
  add('COGS', 'supplies_stock', 'Vật tư nhập kho', input.supplyPurchaseCents, 'inventory');

  let nonPlIn = 0, nonPlOut = 0, unreviewed = 0;
  for (const l of live) {
    // Already on the statement from their source (sales summary, payroll
    // runs, inventory) or not money in or out at all (a transfer).
    if (l.source === 'SALES' || l.source === 'REFUND' || l.source === 'TRANSFER' || l.source === 'PAYROLL' || l.source === 'STOCK') continue;
    if (!l.countsInPl) {
      if (l.direction === 'IN') nonPlIn += l.amountCents; else nonPlOut += l.amountCents;
      continue;
    }
    if (l.source === 'SHIFT_DIFF') {
      if (l.direction === 'IN') add('INCOME', 'cash_over', 'Thừa tiền mặt khi chốt ca', l.amountCents, 'shift');
      else add('OTHER', 'cash_short', 'Thiếu tiền mặt khi chốt ca', l.amountCents, 'shift');
      continue;
    }
    const c = l.categoryId ? cats.get(l.categoryId) : undefined;
    if (!c) {
      // A drawer movement nobody classified.
      if (l.needsReview) unreviewed += l.amountCents;
      if (l.direction === 'IN') add('INCOME', 'unclassified_in', 'Thu chưa phân loại', l.amountCents, 'drawer');
      else add('OTHER', 'unclassified_out', 'Chi ngăn kéo chưa phân loại', l.amountCents, 'drawer');
      continue;
    }
    const group: CatGroup = l.direction === 'IN' ? 'INCOME' : (c.group === 'INCOME' || c.group === 'NON_PL' ? 'OTHER' : c.group);
    add(group, `cat:${c.id}`, c.name, l.amountCents, l.source === 'DRAWER' ? 'drawer' : 'vouchers', c.id, c.budgetCents);
  }

  const section = (g: CatGroup): PnlSection => {
    const list = [...rows.values()].filter((r) => r.group === g).sort((a, b) => b.cents - a.cents)
      .map(({ group: _g, ...r }) => r);
    return { group: g, label: GROUP_LABEL[g], rows: list, totalCents: list.reduce((n, r) => n + r.cents, 0) };
  };
  const otherIncome = section('INCOME');
  const expenses = (['COGS', 'STAFF', 'OPS', 'MARKETING', 'OTHER'] as CatGroup[]).map(section);
  const expenseCents = expenses.reduce((n, s) => n + s.totalCents, 0);
  const incomeCents = input.sales.netCents + otherIncome.totalCents;
  const profitCents = incomeCents - expenseCents;
  return {
    revenue: { grossCents: input.sales.grossCents, discountCents: input.sales.discountCents, refundCents: input.sales.refundCents, netCents: input.sales.netCents },
    otherIncome, incomeCents, expenses, expenseCents, profitCents,
    marginBp: input.sales.netCents > 0 ? Math.round((profitCents / input.sales.netCents) * 10000) : null,
    outside: { tipsCents: input.sales.tipsCents, taxCents: input.sales.taxCents, nonPlInCents: nonPlIn, nonPlOutCents: nonPlOut },
    unreviewedCents: unreviewed,
  };
}

/** Payroll totals as frozen on a closed run → the figures the P&L needs. */
export function payrollFigures(run: { id: string; periodFrom: string; periodTo: string; totals: unknown }): PayrollFigures {
  const t = (run.totals ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof t[k] === 'number' && Number.isFinite(t[k] as number) ? Math.round(t[k] as number) : 0);
  return {
    runId: run.id, periodFrom: run.periodFrom, periodTo: run.periodTo,
    earningsCents: n('earningsCents'), adjustmentsCents: n('adjustmentsCents'),
    tipsNetCents: n('tipsNetCents'), cardTipFeeCents: n('cardTipFeeCents'), netPayCents: n('netPayCents'),
  };
}

// ---------------------------------------------------------------------------
// recurring costs

export type Cadence = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

function parseDay(k: string): { y: number; m: number; d: number } {
  const [y, m, d] = k.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
}
function fmtDay(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addDaysKey(k: string, n: number): string {
  const { y, m, d } = parseDay(k);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The due day after `due`. A monthly cost anchored on the 31st falls on the
 * last day of shorter months and comes back to the 31st when it can; a yearly
 * one on Feb 29 falls on Feb 28 in other years.
 */
export function advanceDue(due: string, cadence: Cadence, anchorDay: string): string {
  if (cadence === 'WEEKLY') return addDaysKey(due, 7);
  const a = parseDay(anchorDay);
  const { y, m } = parseDay(due);
  if (cadence === 'MONTHLY') {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return fmtDay(ny, nm, Math.min(a.d, daysIn(ny, nm)));
  }
  const ny = y + 1;
  return fmtDay(ny, a.m, Math.min(a.d, daysIn(ny, a.m)));
}

/** Every due day from `nextDue` up to `today` (at most `cap`), and the one after them. */
export function dueDaysUpTo(nextDue: string, today: string, cadence: Cadence, anchorDay: string, cap = 60): { due: string[]; next: string } {
  const due: string[] = [];
  let k = nextDue;
  while (k <= today && due.length < cap) { due.push(k); k = advanceDue(k, cadence, anchorDay); }
  return { due, next: k };
}

// ---------------------------------------------------------------------------
// voucher numbers

/** PT-000042 / PC-000042 / CQ-000042 from a running number. */
export function voucherCode(prefix: 'PT' | 'PC' | 'CQ', n: number): string {
  return `${prefix}-${String(Math.max(1, Math.floor(n))).padStart(6, '0')}`;
}

/** The highest running number already used for a prefix, from existing codes. */
export function lastNumber(codes: string[], prefix: string): number {
  let max = 0;
  for (const c of codes) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(c);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
