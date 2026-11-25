/**
 * Restaurant alerts and the night log (19/11/2026), from the approved mockup
 * "Thông báo & nhật ký: vào ca, mở bàn, thu tiền, huỷ, đóng ca".
 *
 * Pure pieces only — no database, no clock of its own — so every rule here
 * has a test: which audit actions belong to the night log, which kind each
 * one is, which alert setting it answers to, the owner's alert settings
 * (cleaned), and the words on the lock screen.
 *
 * Nothing new is written for the log: every till action already lands in
 * audit_logs with tenant_id, user_id and the time (restaurant.service.ts,
 * cash-shifts.service.ts, pos.service.ts). The log is a reading of that
 * table, so it cannot drift from what happened and nobody can edit it.
 */

export const ALERT_KEYS = ['shiftOpen', 'shiftClose', 'checkVoid', 'itemVoids', 'bigDiscount', 'tableOpen', 'paid', 'nightly'] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];
export type Audience = { owner: boolean; manager: boolean };

export interface AlertSettings {
  notify: Record<AlertKey, Audience>;
  /** Dishes taken back (after they went to the kitchen) within `voidWindowMin` minutes that raise one alert. */
  voidItems: number;
  voidWindowMin: number;
  /** A bill discounted by this share of its value or more. */
  discountPct: number;
  /** A shift closed this far from what the drawer should hold (either way). */
  varianceCents: number;
  /** A shift still open after this many hours. */
  shiftMaxHours: number;
  /** Closing a shift needs a second person's approval PIN. */
  witnessOnClose: boolean;
}

const ON: Audience = { owner: true, manager: true };
export const DEFAULT_ALERTS: AlertSettings = {
  notify: {
    shiftOpen: ON,
    shiftClose: ON,
    checkVoid: ON,
    itemVoids: ON,
    bigDiscount: { owner: true, manager: false },
    tableOpen: { owner: false, manager: true },
    // Every bill would bury the alerts that matter; off until someone asks.
    paid: { owner: false, manager: false },
    nightly: ON,
  },
  voidItems: 3,
  voidWindowMin: 30,
  discountPct: 30,
  varianceCents: 100_000,
  shiftMaxHours: 14,
  witnessOnClose: false,
};

function int(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
}

/** What the owner saved, with junk dropped and every gap filled from the defaults. */
export function cleanAlerts(raw: unknown): AlertSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (r.notify && typeof r.notify === 'object' ? r.notify : {}) as Record<string, unknown>;
  const notify = {} as Record<AlertKey, Audience>;
  for (const k of ALERT_KEYS) {
    const a = (n[k] && typeof n[k] === 'object' ? n[k] : {}) as Record<string, unknown>;
    notify[k] = {
      owner: typeof a.owner === 'boolean' ? a.owner : DEFAULT_ALERTS.notify[k].owner,
      manager: typeof a.manager === 'boolean' ? a.manager : DEFAULT_ALERTS.notify[k].manager,
    };
  }
  return {
    notify,
    voidItems: int(r.voidItems, 1, 50, DEFAULT_ALERTS.voidItems),
    voidWindowMin: int(r.voidWindowMin, 5, 240, DEFAULT_ALERTS.voidWindowMin),
    discountPct: int(r.discountPct, 5, 100, DEFAULT_ALERTS.discountPct),
    varianceCents: int(r.varianceCents, 0, 1_000_000_000, DEFAULT_ALERTS.varianceCents),
    shiftMaxHours: int(r.shiftMaxHours, 4, 48, DEFAULT_ALERTS.shiftMaxHours),
    witnessOnClose: typeof r.witnessOnClose === 'boolean' ? r.witnessOnClose : DEFAULT_ALERTS.witnessOnClose,
  };
}

export type LogKind = 'shift' | 'table' | 'money' | 'void' | 'discount' | 'cash';

/** The audit actions the night log shows, and what kind each one is. */
export const LOG_ACTIONS: Record<string, LogKind> = {
  'pos.shift_opened': 'shift',
  'pos.shift_closed': 'shift',
  'restaurant.check_opened': 'table',
  'restaurant.check_moved': 'table',
  'restaurant.checks_merged': 'table',
  'restaurant.check_split': 'table',
  'restaurant.check_paid': 'money',
  'restaurant.bank_credit': 'money',
  'restaurant.check_reopened': 'void',
  'restaurant.check_voided': 'void',
  'restaurant.item_voided': 'void',
  // rt234: after the guest check was printed.
  'restaurant.after_prebill_change': 'void',
  'restaurant.paid_below_prebill': 'void',
  'order.voided': 'void',
  'order.refunded': 'void',
  'pos.held_discarded': 'void',
  'pos.cash_in': 'cash',
  'pos.cash_out': 'cash',
};

export function logKindOf(action: string): LogKind | null {
  return LOG_ACTIONS[action] ?? null;
}

/** Which alert setting an audit action answers to (item voids and discounts are decided later, by threshold). */
export function alertKeyOf(action: string): AlertKey | null {
  switch (action) {
    case 'pos.shift_opened': return 'shiftOpen';
    case 'pos.shift_closed': return 'shiftClose';
    case 'restaurant.check_voided':
    case 'order.voided':
    case 'order.refunded':
    case 'restaurant.check_reopened':
    case 'restaurant.after_prebill_change': // only when it lowered the bill (night-log.service decides)
    case 'restaurant.paid_below_prebill': return 'checkVoid';
    case 'restaurant.item_voided': return 'itemVoids';
    case 'restaurant.check_opened': return 'tableOpen';
    case 'restaurant.check_paid': return 'paid';
    default: return null;
  }
}

/** Is this bill's discount big enough to tell the owner? */
export function isBigDiscount(discountCents: number, beforeCents: number, pct: number): boolean {
  if (!(discountCents > 0) || !(beforeCents > 0)) return false;
  return discountCents * 100 >= beforeCents * pct;
}

/** A shift's drawer is far enough off to say so. */
export function varianceMatters(varianceCents: number | null | undefined, limitCents: number): boolean {
  return typeof varianceCents === 'number' && varianceCents !== 0 && Math.abs(varianceCents) >= limitCents;
}

/** The people an alert goes to: owners and/or managers, never the person who did it. */
export function recipientsFor(
  aud: Audience,
  people: { id: string; kind: 'owner' | 'manager' }[],
  actorId?: string | null,
): string[] {
  return people.filter((p) => p.id !== actorId && (p.kind === 'owner' ? aud.owner : aud.manager)).map((p) => p.id);
}

export interface AlertFacts {
  vi: boolean;
  money: (cents: number) => string;
  who?: string | null;
  approver?: string | null;
  table?: string | null;
  checkNumber?: number | null;
  orderNumber?: number | null;
  amountCents?: number | null;
  reason?: string | null;
  guests?: number | null;
  method?: string | null;
  openingCents?: number | null;
  expectedCents?: number | null;
  countedCents?: number | null;
  varianceCents?: number | null;
  witness?: string | null;
  items?: number | null;
  windowMin?: number | null;
  discountCents?: number | null;
  pct?: number | null;
}

/** The lock-screen title and body for one alert. Short: a phone shows two lines. */
export function alertText(kind: AlertKey | 'bigDiscount', action: string, f: AlertFacts): { title: string; body: string } {
  const L = (v: string, e: string) => (f.vi ? v : e);
  const m = (c?: number | null) => f.money(Math.abs(c ?? 0));
  const who = f.who || L('Nhân viên', 'Staff');
  const where = [f.table, f.checkNumber ? `#${f.checkNumber}` : null].filter(Boolean).join(' · ');
  const why = f.reason ? L(` Lý do: “${f.reason}”.`, ` Reason: “${f.reason}”.`) : '';
  const ok = f.approver && f.approver !== f.who ? L(`, ${f.approver} duyệt`, `, approved by ${f.approver}`) : '';
  switch (kind) {
    case 'shiftOpen':
      return { title: L(`${who} vào ca`, `${who} started a shift`), body: L(`Tiền đầu ca ${m(f.openingCents)}`, `Opening float ${m(f.openingCents)}`) };
    case 'shiftClose': {
      const v = f.varianceCents ?? 0;
      const state = v === 0 ? L('đủ tiền', 'balanced') : v < 0 ? L(`thiếu ${m(v)}`, `short ${m(v)}`) : L(`dư ${m(v)}`, `over ${m(v)}`);
      const witness = f.witness ? L(` ${f.witness} kiểm két.`, ` Checked by ${f.witness}.`) : '';
      return {
        title: L(`Đóng ca · ${state}`, `Shift closed · ${state}`),
        body: L(`${who} đóng ca. Phải có ${m(f.expectedCents)}, đếm được ${m(f.countedCents)}.`, `${who} closed the shift. Should hold ${m(f.expectedCents)}, counted ${m(f.countedCents)}.`) + witness,
      };
    }
    case 'checkVoid': {
      if (action === 'order.refunded') {
        return { title: L(`Hoàn tiền bill #${f.orderNumber ?? '?'} · ${m(f.amountCents)}`, `Refund on bill #${f.orderNumber ?? '?'} · ${m(f.amountCents)}`), body: L(`${who} hoàn tiền${ok}.`, `${who} refunded${ok}.`) + why };
      }
      if (action === 'restaurant.paid_below_prebill') {
        return {
          title: L(`Thu ít hơn tạm tính${f.orderNumber ? ` · bill #${f.orderNumber}` : ''} · thiếu ${m(f.amountCents)}`, `Paid less than the guest check${f.orderNumber ? ` · bill #${f.orderNumber}` : ''} · ${m(f.amountCents)} short`),
          body: L(`${where ? where + ' · ' : ''}${who} thu tiền.`, `${where ? where + ' · ' : ''}${who} took payment.`) + why,
        };
      }
      if (action === 'restaurant.after_prebill_change') {
        return {
          title: L(`Bớt món sau khi in tạm tính · ${m(f.amountCents)}`, `Dish taken off after the guest check · ${m(f.amountCents)}`),
          body: L(`${where ? where + ' · ' : ''}${who} bớt${ok}.`, `${where ? where + ' · ' : ''}${who} took it off${ok}.`) + why,
        };
      }
      if (action === 'restaurant.check_reopened') {
        return { title: L(`Mở lại bill đã thu${f.orderNumber ? ` #${f.orderNumber}` : ''}`, `Paid bill reopened${f.orderNumber ? ` #${f.orderNumber}` : ''}`), body: L(`${where ? where + ' · ' : ''}${who} mở lại.`, `${where ? where + ' · ' : ''}${who} reopened it.`) + why };
      }
      const num = action === 'order.voided' ? f.orderNumber : f.checkNumber;
      const label = action === 'order.voided' ? L('Huỷ bill đã thu', 'Paid bill voided') : L('Huỷ bill', 'Bill voided');
      return {
        title: `${label}${num ? ` #${num}` : ''}${f.amountCents ? ` · ${m(f.amountCents)}` : ''}`,
        body: L(`${f.table ? f.table + ' · ' : ''}${who} huỷ${ok}.`, `${f.table ? f.table + ' · ' : ''}${who} voided${ok}.`) + why,
      };
    }
    case 'itemVoids':
      return {
        title: L(`Huỷ nhiều món · ${f.items} món trong ${f.windowMin} phút`, `Many dishes taken back · ${f.items} in ${f.windowMin} min`),
        body: L(`Tổng ${m(f.amountCents)}, đã báo bếp. Mới nhất: ${who}${where ? ` · ${where}` : ''}.`, `Total ${m(f.amountCents)}, already sent to the kitchen. Latest: ${who}${where ? ` · ${where}` : ''}.`),
      };
    case 'bigDiscount':
      return {
        title: L(`Giảm ${f.pct}% · bill #${f.orderNumber ?? '?'}`, `${f.pct}% off · bill #${f.orderNumber ?? '?'}`),
        body: L(`${where ? where + ' · ' : ''}giảm ${m(f.discountCents)} · ${who}`, `${where ? where + ' · ' : ''}${m(f.discountCents)} off · ${who}`),
      };
    case 'tableOpen':
      return { title: L(`Mở ${f.table || 'bàn'}${f.guests ? ` · ${f.guests} khách` : ''}`, `${f.table || 'Table'} opened${f.guests ? ` · ${f.guests} guests` : ''}`), body: who };
    case 'paid':
      return { title: L(`Đã thu #${f.orderNumber ?? '?'} · ${m(f.amountCents)}`, `Paid #${f.orderNumber ?? '?'} · ${m(f.amountCents)}`), body: [f.table, f.method, who].filter(Boolean).join(' · ') };
    case 'nightly':
    default:
      return { title: '', body: '' };
  }
}

/** The night summary sent at the start of the business day. */
export function nightlyText(f: { vi: boolean; money: (c: number) => string; label: string; netCents: number; bills: number; voidedBills: number; voidedCents: number; voidItems: number; voidItemCents: number; openShift: boolean }): { title: string; body: string } {
  const L = (v: string, e: string) => (f.vi ? v : e);
  const parts = [
    L(`${f.bills} bill`, `${f.bills} bills`),
    f.voidedBills ? L(`huỷ ${f.voidedBills} bill ${f.money(f.voidedCents)}`, `${f.voidedBills} voided ${f.money(f.voidedCents)}`) : null,
    f.voidItems ? L(`huỷ ${f.voidItems} món ${f.money(f.voidItemCents)}`, `${f.voidItems} dishes back ${f.money(f.voidItemCents)}`) : null,
    f.openShift ? L('ca chưa chốt', 'shift still open') : null,
  ].filter(Boolean);
  return { title: L(`${f.label}: ${f.money(f.netCents)}`, `${f.label}: ${f.money(f.netCents)}`), body: parts.join(' · ') };
}

/** The business day (yyyy-mm-dd of its start) that `now` belongs to, in the salon's zone. */
export function businessDayKey(now: Date, tz: string, dayStartHour: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  let key = `${get('year')}-${get('month')}-${get('day')}`;
  if (Number(get('hour')) < dayStartHour) {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    key = d.toISOString().slice(0, 10);
  }
  return key;
}
