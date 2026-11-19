/**
 * The words, icon and tone of one line of the restaurant night log (19/11/2026).
 * Pure, so it has a test; the screen is components/restaurant/NightLog.tsx.
 */
export type Kind = 'shift' | 'table' | 'money' | 'void' | 'discount' | 'cash';
export interface LogEvent {
  id: string; at: string; action: string; kind: Kind;
  by: string | null; approvedBy: string | null; witness: string | null;
  table: string | null; checkNumber: number | null; orderNumber: number | null;
  amountCents: number | null; discountCents: number | null; discountPct: number | null; method: string | null;
  reason: string | null; name: string | null; quantity: number | null; guests: number | null;
  expectedCents: number | null; countedCents: number | null; takeaway: boolean;
}
export interface LogResp { mine: boolean; truncated: boolean; discountPct: number; counts: Record<string, number>; events: LogEvent[] }
export interface ShiftResp { shift: { status: string; openedByName: string | null; openedAt: string; openingCents: number } | null; summary: { byMethod: { cashCents: number; cardCents: number; otherCents: number }; changeCents: number; expectedCashCents: number; voidedItems?: { count: number; totalCents: number } } | null }

export type Filter = 'all' | 'void' | 'money' | 'shift' | 'table' | 'discount';

/** Icon, tone and words for one line of the log. Exported for its test. */
export function describe(e: LogEvent, vi: boolean, money: (c: number) => string): { icon: string; tone: 'g' | 'b' | 'y' | 'i' | 'n'; title: string; amount: string | null; amountTone?: 'bad' | 'warn' | 'good'; sub: string; alarm: boolean } {
  const L = (v: string, en: string) => (vi ? v : en);
  const who = e.by ?? L('Không rõ', 'Unknown');
  const where = [e.table ?? (e.takeaway ? L('Mang về', 'Takeaway') : null), e.checkNumber ? `${L('phiếu', 'check')} ${e.checkNumber}` : null].filter(Boolean).join(' · ');
  const ok = e.approvedBy ? L(` · ${e.approvedBy} duyệt`, ` · approved by ${e.approvedBy}`) : '';
  const why = e.reason ? L(` · Lý do: ${e.reason}`, ` · Reason: ${e.reason}`) : '';
  const m = (c: number | null) => (c === null ? null : money(Math.abs(c)));
  switch (e.action) {
    case 'pos.shift_opened': return { icon: '🟢', tone: 'g', title: L(`${who} vào ca`, `${who} started a shift`), amount: m(e.amountCents), sub: L('Tiền đầu ca', 'Opening float'), alarm: false };
    case 'pos.shift_closed': {
      const v = e.amountCents ?? 0;
      return {
        icon: '🔒', tone: v === 0 ? 'n' : 'b', title: L(`${who} đóng ca`, `${who} closed the shift`),
        amount: v === 0 ? L('Đủ tiền', 'Balanced') : `${v < 0 ? L('Thiếu', 'Short') : L('Dư', 'Over')} ${m(v)}`, amountTone: v === 0 ? 'good' : v < 0 ? 'bad' : 'warn',
        sub: [e.countedCents !== null ? L(`Đếm ${money(e.countedCents)}`, `Counted ${money(e.countedCents)}`) : null, e.expectedCents !== null ? L(`phải có ${money(e.expectedCents)}`, `should hold ${money(e.expectedCents)}`) : null, e.witness ? L(`${e.witness} kiểm két`, `checked by ${e.witness}`) : null].filter(Boolean).join(' · ') + why,
        alarm: v < 0,
      };
    }
    case 'restaurant.check_opened': return { icon: '🍽️', tone: 'i', title: L(`Mở ${e.table ?? (e.takeaway ? 'mang về' : 'bàn')}${e.guests ? ` · ${e.guests} khách` : ''}`, `${e.table ?? (e.takeaway ? 'Takeaway' : 'Table')} opened${e.guests ? ` · ${e.guests} guests` : ''}`), amount: null, sub: who, alarm: false };
    case 'restaurant.check_moved': return { icon: '🔀', tone: 'n', title: L(`Chuyển bàn${e.table ? ` → ${e.table}` : ''}`, `Moved${e.table ? ` → ${e.table}` : ''}`), amount: null, sub: who, alarm: false };
    case 'restaurant.checks_merged': return { icon: '🔗', tone: 'n', title: L(`Gộp bill${e.table ? ` vào ${e.table}` : ''}`, `Bills merged${e.table ? ` into ${e.table}` : ''}`), amount: null, sub: who, alarm: false };
    case 'restaurant.check_split': return { icon: '✂️', tone: 'n', title: L(`Tách bill${e.table ? ` · ${e.table}` : ''}`, `Bill split${e.table ? ` · ${e.table}` : ''}`), amount: null, sub: who, alarm: false };
    case 'restaurant.check_paid': {
      const big = e.discountPct !== null && e.discountPct > 0;
      return {
        icon: big ? '🏷️' : '✅', tone: big ? 'y' : 'g',
        title: L(`Thu #${e.orderNumber ?? '?'}${e.table ? ` · ${e.table}` : ''}`, `Paid #${e.orderNumber ?? '?'}${e.table ? ` · ${e.table}` : ''}`),
        amount: m(e.amountCents),
        sub: [e.method, who, big ? L(`giảm ${e.discountPct}% (${money(e.discountCents ?? 0)})`, `${e.discountPct}% off (${money(e.discountCents ?? 0)})`) : null].filter(Boolean).join(' · '),
        alarm: false,
      };
    }
    case 'restaurant.bank_credit': return { icon: '🏦', tone: 'g', title: L(`Tiền vào ngân hàng${e.checkNumber ? ` · phiếu ${e.checkNumber}` : ''}`, `Bank credit${e.checkNumber ? ` · check ${e.checkNumber}` : ''}`), amount: m(e.amountCents), sub: e.table ?? '', alarm: false };
    case 'restaurant.item_voided': return { icon: '↩️', tone: 'y', title: L(`Huỷ ${e.quantity ?? 1} × ${e.name ?? 'món'}`, `Took back ${e.quantity ?? 1} × ${e.name ?? 'dish'}`), amount: m(e.amountCents), amountTone: 'warn', sub: `${where ? where + ' · ' : ''}${who}${ok}${why}`, alarm: false };
    case 'restaurant.check_voided': return { icon: '⛔', tone: 'b', title: L(`Huỷ ${e.checkNumber ? `phiếu ${e.checkNumber}` : 'bàn'}`, `Voided ${e.checkNumber ? `check ${e.checkNumber}` : 'table'}`), amount: null, sub: `${e.table ? e.table + ' · ' : ''}${who}${ok}${why}`, alarm: true };
    case 'order.voided': return { icon: '⛔', tone: 'b', title: L(`Huỷ bill đã thu #${e.orderNumber ?? '?'}`, `Paid bill voided #${e.orderNumber ?? '?'}`), amount: m(e.amountCents), amountTone: 'bad', sub: `${who}${ok}${why}`, alarm: true };
    case 'order.refunded': return { icon: '💸', tone: 'b', title: L(`Hoàn tiền bill #${e.orderNumber ?? '?'}`, `Refund on bill #${e.orderNumber ?? '?'}`), amount: m(e.amountCents), amountTone: 'bad', sub: `${who}${ok}${why}`, alarm: true };
    case 'restaurant.check_reopened': return { icon: '⚠️', tone: 'y', title: L(`Mở lại bill đã thu${e.orderNumber ? ` #${e.orderNumber}` : ''}`, `Paid bill reopened${e.orderNumber ? ` #${e.orderNumber}` : ''}`), amount: null, sub: `${where ? where + ' · ' : ''}${who}${why}`, alarm: true };
    case 'pos.cash_in': return { icon: '➕', tone: 'n', title: L('Thu thêm vào két', 'Cash in'), amount: m(e.amountCents), sub: `${who}${why}`, alarm: false };
    case 'pos.cash_out': return { icon: '➖', tone: 'y', title: L('Chi tiền từ két', 'Cash out'), amount: m(e.amountCents), amountTone: 'warn', sub: `${who}${why}`, alarm: false };
    default: return { icon: '•', tone: 'n', title: e.action, amount: m(e.amountCents), sub: who, alarm: false };
  }
}

