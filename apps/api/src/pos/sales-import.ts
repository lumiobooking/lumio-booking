/**
 * NHẬP DOANH THU CŨ — the old system's (or the handwritten book's) sales,
 * turned into the same paid tickets the till writes, so the sales report,
 * payroll, staff performance and the dashboard count them with no special
 * case. Pure: parsing, matching and grouping only; the service writes.
 *
 * One row = one line of a bill. The page maps the file's columns to these
 * keys; anything the old system did not have stays empty:
 *
 *   date      day of the sale (required)          2026-09-14 · 14/09/2026 · 09/14/2026 · Excel serial
 *   time      time of day (optional, default 12:00 noon)
 *   bill      bill / receipt number (optional). Rows sharing date + bill = one ticket.
 *   customer  customer name (optional)
 *   phone     customer phone (optional) — links the visit to the client's history
 *   staff     technician (required for payroll; empty = "unassigned" sales)
 *   item      service or product name (default "Dịch vụ")
 *   kind      service | product (default service)
 *   amount    what the line sold for, before tip (required)
 *   tip       tip for this line's technician (optional)
 *   discount  discount on the bill (optional; summed over the bill's rows)
 *   method    cash · card · transfer · Zelle · MoMo · … (optional; unknown = OTHER)
 *   count     number of customers this row stands for (optional, handwritten
 *             day totals: "Lan · 1.250.000 · 9 khách" becomes 9 tickets that
 *             add up to exactly the total, so visits are right too)
 *
 * The rules a salon would expect:
 *  - Money is read in the salon's currency: "250.000" is 250,000 đồng in a VND
 *    salon and $250.00 in a USD one; "45.50" is $45.50; "250k" is 250,000.
 *  - Dates are day-first in Vietnam and month-first in the US/Canada; a first
 *    number above 12 is read the other way round.
 *  - A day in the future, or inside a payroll period that is already closed
 *    (FINAL), is refused: payslips that were paid must not change under anyone.
 *  - Each ticket has a stable signature, so importing the same file twice adds
 *    nothing the second time.
 */

export type Kind = 'SERVICE' | 'PRODUCT';
export type Method = 'CASH' | 'CARD' | 'TRANSFER' | 'VIETQR' | 'MOMO' | 'ZALOPAY' | 'OTHER';

export interface SaleRowIn {
  date?: unknown; time?: unknown; bill?: unknown; customer?: unknown; phone?: unknown; staff?: unknown;
  item?: unknown; kind?: unknown; amount?: unknown; tip?: unknown; discount?: unknown; method?: unknown; count?: unknown;
  /** Typed in Lumio itself: the technician picked from the salon's own list (wins over `staff`). */
  staffId?: unknown;
}

export interface StaffRef { id: string; firstName: string; lastName?: string | null }
export interface ServiceRef { id: string; name: string }

export interface TicketLine {
  name: string; kind: Kind; amount: number; tip: number;
  staffId: string | null; staffName: string; serviceId: string | null;
}
export interface Ticket {
  /** Stable across re-imports of the same file (day, bill, lines). */
  signature: string;
  day: string;            // YYYY-MM-DD, salon calendar
  minutes: number;        // minutes after midnight, salon time
  bill: string | null;
  customer: string | null;
  phone: string | null;
  method: Method;
  discount: number;
  lines: TicketLine[];
  rows: number[];         // 1-based source rows
}

export interface BuildCtx {
  /** Decimal places of the salon's currency (USD 2, VND 0). */
  digits: number;
  /** Day-first dates (Vietnam) or month-first (US/CA). */
  dayFirst: boolean;
  /** Today in the salon's calendar: later days are refused. */
  todayKey: string;
  staff: StaffRef[];
  services: ServiceRef[];
  /** Closed payroll periods [from, to] (inclusive day keys). */
  locked: Array<{ from: string; to: string }>;
  /** The owner's answer for names the file uses that match nobody: name (folded) → staff id, or '' = leave unassigned. */
  staffMap?: Record<string, string>;
}

export interface BuildResult {
  tickets: Ticket[];
  errors: Array<{ row: number; reason: string }>;
  /** Technician names in the file that match no one (folded name → rows count, as written). */
  unknownStaff: Array<{ key: string; name: string; rows: number }>;
  lockedRows: number;
}

const str = (v: unknown, max = 200) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);

/** Lower-case, no Vietnamese marks, single spaces — for matching names. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Money in the salon's minor units, or null when the cell is not a number.
 * Empty → 0. Negative → null (a refund is not a sale; it is left out and reported).
 */
export function parseMoney(v: unknown, digits: number): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 10 ** digits) : null;
  let s = str(v, 40).toLowerCase();
  if (!s) return 0;
  if (/^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.,()-]/g, ''))) return null;
  let mult = 1;
  if (/\d\s*(k|nghìn|ngàn)\b/.test(s)) mult = 1000;
  else if (/\d\s*(tr|triệu|m)\b/.test(s)) mult = 1_000_000;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  let n: number;
  if (digits === 0) {
    // No sub-unit: every separator is a thousands separator ("1.250.000", "1,250,000")
    // unless the multiplier says otherwise ("1.5tr").
    if (mult > 1 && /^\d+[.,]\d{1,2}$/.test(s)) n = Number(s.replace(',', '.'));
    else n = Number(s.replace(/[.,]/g, ''));
  } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));   // 1.234,50
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) n = Number(s.replace(/\./g, ''));                                 // 1.250.000
  else if (/^\d+,\d{1,2}$/.test(s)) n = Number(s.replace(',', '.'));                                       // 45,50
  else n = Number(s.replace(/,/g, ''));                                                                  // 1,234.50 / 45.50 / 45
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult * 10 ** digits);
}

const pad = (n: number) => String(n).padStart(2, '0');
const isDay = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
};

/** A day key 'YYYY-MM-DD', or null. Excel serial numbers (45000-ish) are read as dates. */
export function parseDay(v: unknown, dayFirst: boolean): string | null {
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(str(v, 20))) {
    const serial = Math.floor(Number(v));
    if (serial > 30000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }
  const s = str(v, 40);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isDay(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    let [d, mo] = dayFirst ? [a, b] : [b, a];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return isDay(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

/** Minutes after midnight; default noon (a sale at noon cannot slip into the next or previous day). */
export function parseTime(v: unknown): number {
  const s = str(v, 20).toLowerCase();
  const m = /^(\d{1,2})(?::|h)(\d{2})?\s*(am|pm|sa|ch)?/.exec(s) ?? /^(\d{1,2})\s*(am|pm)$/.exec(s);
  if (!m) return 12 * 60;
  let h = +m[1];
  const mi = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
  const ap = m[3] ?? (m[2] && !/^\d+$/.test(m[2]) ? m[2] : '');
  if ((ap === 'pm' || ap === 'ch') && h < 12) h += 12;
  if ((ap === 'am' || ap === 'sa') && h === 12) h = 0;
  return h >= 0 && h < 24 && mi < 60 ? h * 60 + mi : 12 * 60;
}

export function parseMethod(v: unknown): Method {
  const s = fold(str(v, 40));
  if (!s) return 'OTHER';
  if (/^(cash|tien mat|tm|cash only)$|tien mat|\bcash\b/.test(s)) return 'CASH';
  if (/momo/.test(s)) return 'MOMO';
  if (/zalo/.test(s)) return 'ZALOPAY';
  if (/vietqr|\bqr\b/.test(s)) return 'VIETQR';
  if (/\b(card|the|visa|master|mastercard|amex|credit|debit|discover|quet the|cc)\b/.test(s)) return 'CARD';
  if (/transfer|chuyen khoan|\bck\b|zelle|venmo|cash ?app|paypal|interac|bank|e ?transfer/.test(s)) return 'TRANSFER';
  return 'OTHER';
}

export function parseKind(v: unknown): Kind {
  return /^(sp|san pham|product|retail|hang|ban le|item)$|san pham|product|retail/.test(fold(str(v, 40))) ? 'PRODUCT' : 'SERVICE';
}

/** Whole number ≥ 1 (customers on a summary row), else 1. Capped at 200. */
export function parseCount(v: unknown): number {
  const n = Math.round(Number(str(v, 10).replace(/[^\d]/g, '')));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 1;
}

/**
 * Who a written name is. Exact full name first (either order), then the
 * first name alone; a first name two technicians share matches nobody (the owner
 * picks). Returns null when nothing matches or it is ambiguous.
 */
export function matchStaff(name: string, staff: StaffRef[]): string | null {
  const f = fold(name);
  if (!f) return null;
  const full = staff.filter((s) => fold(`${s.firstName} ${s.lastName ?? ''}`) === f || fold(`${s.lastName ?? ''} ${s.firstName}`) === f);
  if (full.length === 1) return full[0].id;
  const first = staff.filter((s) => fold(s.firstName) === f);
  if (first.length === 1) return first[0].id;
  return null;
}

export function matchService(name: string, services: ServiceRef[]): string | null {
  const f = fold(name);
  if (!f) return null;
  const hit = services.filter((s) => fold(s.name) === f);
  return hit.length === 1 ? hit[0].id : null;
}

/** Split `total` into `n` whole parts that add up exactly (earlier parts take the remainder). */
export function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** A short stable string for a ticket — the service hashes it. */
export function signatureOf(t: Pick<Ticket, 'day' | 'bill' | 'lines' | 'discount'>, part = 0): string {
  const lines = t.lines.map((l) => `${fold(l.name)}~${fold(l.staffName)}~${l.amount}~${l.tip}`).sort().join('|');
  return `${t.day}#${t.bill ? fold(t.bill) : ''}#${t.discount}#${lines}#${part}`;
}

export function buildTickets(rows: SaleRowIn[], ctx: BuildCtx): BuildResult {
  const errors: BuildResult['errors'] = [];
  const unknown = new Map<string, { name: string; rows: number }>();
  const groups = new Map<string, Ticket>();
  const singles: Ticket[] = [];
  let lockedRows = 0;
  const inLocked = (day: string) => ctx.locked.some((p) => day >= p.from && day <= p.to);

  rows.forEach((r, i) => {
    const row = i + 1;
    const day = parseDay(r.date, ctx.dayFirst);
    if (!day) { errors.push({ row, reason: 'date' }); return; }
    if (day > ctx.todayKey) { errors.push({ row, reason: 'future' }); return; }
    if (inLocked(day)) { lockedRows++; errors.push({ row, reason: 'payroll-closed' }); return; }
    const amount = parseMoney(r.amount, ctx.digits);
    if (amount === null) { errors.push({ row, reason: 'amount' }); return; }
    const tip = parseMoney(r.tip, ctx.digits);
    if (tip === null) { errors.push({ row, reason: 'tip' }); return; }
    if (amount === 0 && tip === 0) { errors.push({ row, reason: 'empty' }); return; }
    const discount = parseMoney(r.discount, ctx.digits) ?? 0;

    let staffName = str(r.staff, 80);
    let staffId: string | null = null;
    // Picked from the list on the entry screen: only one of THIS salon's
    // technicians is accepted; anything else falls back to the name.
    const picked = str(r.staffId, 64);
    const pickedRef = picked ? ctx.staff.find((s) => s.id === picked) : undefined;
    if (pickedRef) {
      staffId = pickedRef.id;
      if (!staffName) staffName = `${pickedRef.firstName}${pickedRef.lastName ? ` ${pickedRef.lastName}` : ''}`;
    } else if (staffName) {
      const key = fold(staffName);
      if (ctx.staffMap && key in ctx.staffMap) staffId = ctx.staffMap[key] || null;
      else {
        staffId = matchStaff(staffName, ctx.staff);
        if (!staffId) {
          const u = unknown.get(key) ?? { name: staffName, rows: 0 };
          u.rows += 1; unknown.set(key, u);
        }
      }
    }
    const item = str(r.item, 120) || 'Dịch vụ';
    const kind = parseKind(r.kind);
    const line: TicketLine = {
      name: item, kind, amount, tip, staffId, staffName,
      serviceId: kind === 'SERVICE' ? matchService(item, ctx.services) : null,
    };
    const bill = str(r.bill, 40) || null;
    const base = {
      day, minutes: parseTime(r.time), bill,
      customer: str(r.customer, 80) || null,
      phone: str(r.phone, 30).replace(/[^\d+]/g, '') || null,
      method: parseMethod(r.method),
    };
    if (bill) {
      const key = `${day}#${fold(bill)}`;
      const t = groups.get(key) ?? { ...base, signature: '', discount: 0, lines: [], rows: [] };
      t.lines.push(line); t.rows.push(row); t.discount += discount;
      if (!t.customer && base.customer) t.customer = base.customer;
      if (!t.phone && base.phone) t.phone = base.phone;
      if (t.method === 'OTHER' && base.method !== 'OTHER') t.method = base.method;
      groups.set(key, t);
      return;
    }
    // A row with no bill number is a bill of its own — or, with a customer
    // count, that many bills adding up to exactly the row.
    const n = parseCount(r.count);
    const amounts = split(amount, n), tips = split(tip, n), discounts = split(discount, n);
    for (let k = 0; k < n; k++) {
      singles.push({
        ...base, signature: '', discount: discounts[k], rows: [row],
        lines: [{ ...line, amount: amounts[k], tip: tips[k] }],
      });
    }
  });

  const tickets = [...groups.values(), ...singles];
  // Signatures: identical tickets on the same day (two $45 pedicures by Lan
  // on a summary row) are numbered so each is distinct yet stable.
  const seen = new Map<string, number>();
  for (const t of tickets) {
    t.discount = Math.min(t.discount, t.lines.reduce((s, l) => s + l.amount, 0));
    const sig = signatureOf(t);
    const nth = seen.get(sig) ?? 0;
    seen.set(sig, nth + 1);
    t.signature = signatureOf(t, nth);
  }
  tickets.sort((a, b) => (a.day === b.day ? a.minutes - b.minutes : a.day < b.day ? -1 : 1));
  return {
    tickets,
    errors,
    unknownStaff: [...unknown.entries()].map(([key, v]) => ({ key, name: v.name, rows: v.rows })).sort((a, b) => b.rows - a.rows),
    lockedRows,
  };
}

export interface ImportSummary {
  tickets: number;
  lines: number;
  salesCents: number;
  tipsCents: number;
  discountCents: number;
  firstDay: string | null;
  lastDay: string | null;
  byStaff: Array<{ staffId: string | null; name: string; tickets: number; salesCents: number; tipsCents: number }>;
  byMonth: Array<{ month: string; tickets: number; salesCents: number }>;
}

/** What the owner checks before importing: totals per technician and per month. */
export function summarize(tickets: Ticket[], staff: StaffRef[]): ImportSummary {
  const nameOf = new Map(staff.map((s) => [s.id, `${s.firstName}${s.lastName ? ` ${s.lastName}` : ''}`]));
  const byStaff = new Map<string, ImportSummary['byStaff'][number]>();
  const byMonth = new Map<string, ImportSummary['byMonth'][number]>();
  let lines = 0, sales = 0, tips = 0, disc = 0;
  for (const t of tickets) {
    const sold = t.lines.reduce((s, l) => s + l.amount, 0) - t.discount;
    sales += sold; disc += t.discount;
    const m = byMonth.get(t.day.slice(0, 7)) ?? { month: t.day.slice(0, 7), tickets: 0, salesCents: 0 };
    m.tickets += 1; m.salesCents += sold; byMonth.set(m.month, m);
    const credited = new Set<string>();
    for (const l of t.lines) {
      lines += 1; tips += l.tip;
      const key = l.staffId ?? '';
      const row = byStaff.get(key) ?? { staffId: l.staffId, name: l.staffId ? nameOf.get(l.staffId) ?? l.staffName : '', tickets: 0, salesCents: 0, tipsCents: 0 };
      row.salesCents += l.amount; row.tipsCents += l.tip;
      if (!credited.has(key)) { row.tickets += 1; credited.add(key); }
      byStaff.set(key, row);
    }
  }
  const days = tickets.map((t) => t.day).sort();
  return {
    tickets: tickets.length, lines, salesCents: sales, tipsCents: tips, discountCents: disc,
    firstDay: days[0] ?? null, lastDay: days[days.length - 1] ?? null,
    byStaff: [...byStaff.values()].sort((a, b) => b.salesCents - a.salesCents),
    byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}
