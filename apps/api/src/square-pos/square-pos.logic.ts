/**
 * ĐỒNG BỘ VỚI SQUARE POS — the rules, with no database and no network.
 *
 * The salon keeps checking out on its own Square POS (Register, Stand, the
 * Square app). Square cannot show an order made by another program as an open
 * ticket on the device (Square developer forum, Apr 2025), so the sync runs the
 * other way round:
 *
 *   Square → Lumio  every bill paid on Square POS becomes a paid Lumio ticket
 *                   (same tables the till writes, so reports, payroll and tips
 *                   read it), and the booking it paid for is marked done.
 *   Lumio → Square  today's clients are added to Square's customer list, and
 *                   the menu can be sent to Square's item library, so the front
 *                   desk finds both on the Square screen.
 *
 * Only payments taken ON Square POS are read. A card tapped on a Square
 * Terminal driven by Lumio, or a deposit paid through Lumio's payment link, is
 * already in Lumio — reading it again would count the money twice.
 */
import { fold } from '../pos/sales-import';
import { phoneTail } from '../customers/import-rows';

// ---- Square shapes (only the fields read) -----------------------------------

export interface SqMoney { amount?: number | null; currency?: string }
export interface SqPayment {
  id: string;
  created_at?: string;
  status?: string;
  source_type?: string;
  order_id?: string | null;
  customer_id?: string | null;
  team_member_id?: string | null;
  employee_id?: string | null;
  location_id?: string;
  amount_money?: SqMoney;
  tip_money?: SqMoney;
  total_money?: SqMoney;
  receipt_number?: string;
  card_details?: { card?: { card_brand?: string } };
  application_details?: { square_product?: string };
}
export interface SqLineItem {
  uid?: string;
  name?: string;
  variation_name?: string;
  quantity?: string;
  item_type?: string;
  base_price_money?: SqMoney;
  gross_sales_money?: SqMoney;
}
export interface SqOrder {
  id: string;
  state?: string;
  location_id?: string;
  customer_id?: string | null;
  closed_at?: string;
  created_at?: string;
  line_items?: SqLineItem[];
  total_money?: SqMoney;
  total_tax_money?: SqMoney;
  total_discount_money?: SqMoney;
  total_tip_money?: SqMoney;
  total_service_charge_money?: SqMoney;
}
export interface SqRefund { id: string; status?: string; payment_id?: string; amount_money?: SqMoney; created_at?: string }

// ---- what Lumio keeps -------------------------------------------------------

export interface SyncSettings {
  enabled: boolean;
  /** Bills paid on or after this moment are read (never earlier than the day it was turned on, unless the owner chose). */
  since: string | null;
  /** Square team member id → Lumio technician id ('' = leave unassigned). */
  staffMap: Record<string, string>;
  /** Add today's clients to Square's customer list. */
  pushCustomers: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Totals of the last run, for the screen. */
  last: { imported: number; matched: number; skipped: number; refunds: number; customers: number } | null;
  /** Square refunds already written (bounded). */
  refundsDone: string[];
  /** Appointments whose client was already sent to Square (bounded). */
  customersPushed: string[];
}

export const SETTING_KEY = 'square_pos_sync';
export const CLIENT_REF_PREFIX = 'sq:';
export const MAX_BACKFILL_DAYS = 31;
export const LOOKBACK_HOURS = 48;
const KEEP = 1000;

export function defaultSettings(): SyncSettings {
  return { enabled: false, since: null, staffMap: {}, pushCustomers: true, lastRunAt: null, lastOkAt: null, lastError: null, last: null, refundsDone: [], customersPushed: [] };
}

/** A stored value, whatever shape it is in, as settings (junk dropped). */
export function readSettings(v: unknown): SyncSettings {
  const d = defaultSettings();
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const map: Record<string, string> = {};
  if (o.staffMap && typeof o.staffMap === 'object') {
    for (const [k, val] of Object.entries(o.staffMap as Record<string, unknown>)) if (k && typeof val === 'string') map[k] = val;
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(-KEEP) : []);
  return {
    enabled: o.enabled === true,
    since: str(o.since),
    staffMap: map,
    pushCustomers: o.pushCustomers !== false,
    lastRunAt: str(o.lastRunAt),
    lastOkAt: str(o.lastOkAt),
    lastError: str(o.lastError),
    last: o.last && typeof o.last === 'object' ? (o.last as SyncSettings['last']) : null,
    refundsDone: list(o.refundsDone),
    customersPushed: list(o.customersPushed),
  };
}

/** Add to a bounded "already done" list. */
export function remember(list: string[], ids: string[]): string[] {
  const set = new Set(list);
  for (const id of ids) set.add(id);
  return [...set].slice(-KEEP);
}

/**
 * The owner's answers, kept only when they name one of THIS salon's
 * technicians (or '' = unassigned). A technician id of another salon is dropped.
 */
export function cleanStaffMap(input: unknown, ownStaffIds: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
    if (v === '' || (typeof v === 'string' && ownStaffIds.has(v))) out[k] = v as string;
  }
  return out;
}

/**
 * Which stretch of time one run reads.
 *  - the first run after turning it on: from `since` (at most 31 days back);
 *  - after that: the last 48 hours, so a split bill finished later, or a
 *    sync that failed for a while, is still picked up (tickets are keyed by
 *    the Square order, so reading a bill twice writes it once).
 */
export function syncWindow(s: Pick<SyncSettings, 'since' | 'lastOkAt'>, now: Date): { from: Date; to: Date } {
  const floor = new Date(now.getTime() - MAX_BACKFILL_DAYS * 86_400_000);
  const since = s.since ? new Date(s.since) : now;
  let from = s.lastOkAt ? new Date(Math.max(since.getTime(), now.getTime() - LOOKBACK_HOURS * 3_600_000)) : since;
  if (Number.isNaN(from.getTime()) || from < floor) from = floor;
  return { from, to: now };
}

/** A payment rung up ON Square POS and finished — the only kind that is read. */
export function isPosPayment(p: SqPayment): boolean {
  return p.status === 'COMPLETED' && p.application_details?.square_product === 'SQUARE_POS';
}

/** Square's tender as the till's payment method. */
export function methodOf(p: SqPayment): 'CASH' | 'CARD' | 'OTHER' {
  if (p.source_type === 'CASH') return 'CASH';
  if (p.card_details?.card?.card_brand === 'SQUARE_GIFT_CARD') return 'OTHER';
  if (p.source_type === 'CARD' || p.source_type === 'WALLET') return 'CARD';
  return 'OTHER';
}

const amt = (m?: SqMoney | null) => (typeof m?.amount === 'number' && Number.isFinite(m.amount) ? Math.round(m.amount) : 0);

// ---- which booking a bill paid for ------------------------------------------

export interface Candidate {
  id: string;
  startTime: Date;
  endTime: Date;
  assignedStaffId: string | null;
  customerId: string;
  customerPhone: string | null;
}

/**
 * The booking this bill paid for — or none. Wrong is worse than none (a wrong
 * one closes somebody else's visit), so it only answers when it is sure:
 *  1. the client on the Square bill has the phone of a booking around then;
 *  2. otherwise the technician mapped to the Square team member has exactly
 *     one booking under way or just finished at that moment.
 */
export function pickBooking(cands: Candidate[], bill: { phone: string | null; staffId: string | null; paidAt: Date }): { id: string; by: 'phone' | 'staff' } | null {
  const t = bill.paidAt.getTime();
  const near = cands.filter((c) => c.startTime.getTime() <= t + 30 * 60_000 && c.endTime.getTime() >= t - 6 * 3_600_000);
  const tail = phoneTail(bill.phone);
  if (tail) {
    const mine = near.filter((c) => phoneTail(c.customerPhone) === tail);
    if (mine.length) {
      mine.sort((a, b) => Math.abs(a.startTime.getTime() - t) - Math.abs(b.startTime.getTime() - t));
      return { id: mine[0].id, by: 'phone' };
    }
  }
  if (bill.staffId) {
    const theirs = near.filter((c) => c.assignedStaffId === bill.staffId && c.startTime.getTime() <= t + 15 * 60_000 && c.endTime.getTime() >= t - 2 * 3_600_000);
    if (theirs.length === 1) return { id: theirs[0].id, by: 'staff' };
  }
  return null;
}

// ---- one Square bill as a Lumio ticket --------------------------------------

export interface TicketLine { name: string; serviceId: string | null; amount: number; tip: number; staffId: string | null }
export interface Ticket {
  squareOrderId: string;
  paidAt: Date;
  lines: TicketLine[];
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  total: number;
  tenders: { method: 'CASH' | 'CARD' | 'OTHER'; amount: number }[];
  receipt: string | null;
}

/**
 * Lines come from the Square order (its own names and prices); the services
 * whose names match Lumio's menu are linked to them. The money is what the
 * payments say was taken — tips included.
 */
export function buildTicket(order: SqOrder, payments: SqPayment[], ctx: { services: { id: string; name: string }[]; staffId: string | null }): Ticket {
  const byName = new Map<string, string>();
  for (const s of ctx.services) { const k = fold(s.name); if (k && !byName.has(k)) byName.set(k, s.id); }
  const lines: TicketLine[] = [];
  for (const li of order.line_items ?? []) {
    const qty = Math.max(1, Number(li.quantity ?? '1') || 1);
    const gross = li.gross_sales_money ? amt(li.gross_sales_money) : amt(li.base_price_money) * qty;
    const base = String(li.name ?? '').trim() || 'Square item';
    const variation = String(li.variation_name ?? '').trim();
    const name = variation && !/^regular$/i.test(variation) ? `${base} · ${variation}` : base;
    const serviceId = byName.get(fold(name)) ?? byName.get(fold(base)) ?? null;
    lines.push({ name: name.slice(0, 200), serviceId, amount: gross, tip: 0, staffId: ctx.staffId });
  }
  const charge = amt(order.total_service_charge_money);
  if (charge > 0) lines.push({ name: 'Service charge (Square)', serviceId: null, amount: charge, tip: 0, staffId: ctx.staffId });
  const total = payments.reduce((s, p) => s + amt(p.total_money), 0);
  const tip = payments.reduce((s, p) => s + amt(p.tip_money), 0) || amt(order.total_tip_money);
  if (!lines.length) lines.push({ name: 'Square sale', serviceId: null, amount: Math.max(0, total - tip), tip: 0, staffId: ctx.staffId });
  // The tip belongs to the technician of the visit: on her first line.
  lines[0].tip = tip;
  const tenders = new Map<'CASH' | 'CARD' | 'OTHER', number>();
  for (const p of payments) tenders.set(methodOf(p), (tenders.get(methodOf(p)) ?? 0) + amt(p.total_money));
  const stamps = payments.map((p) => (p.created_at ? Date.parse(p.created_at) : NaN)).filter((x) => Number.isFinite(x));
  const closed = order.closed_at ? Date.parse(order.closed_at) : NaN;
  const paidAt = new Date(Number.isFinite(closed) ? closed : stamps.length ? Math.max(...stamps) : Date.now());
  return {
    squareOrderId: order.id,
    paidAt,
    lines,
    subtotal: lines.reduce((s, l) => s + l.amount, 0),
    discount: amt(order.total_discount_money),
    tax: amt(order.total_tax_money),
    tip,
    total,
    tenders: [...tenders.entries()].map(([method, amount]) => ({ method, amount })).filter((t) => t.amount > 0),
    receipt: payments.find((p) => p.receipt_number)?.receipt_number ?? null,
  };
}

/** Group read payments by the Square order they paid. */
export function byOrder(payments: SqPayment[]): Map<string, SqPayment[]> {
  const m = new Map<string, SqPayment[]>();
  for (const p of payments) {
    if (!p.order_id) continue;
    const list = m.get(p.order_id) ?? [];
    if (!list.some((x) => x.id === p.id)) list.push(p);
    m.set(p.order_id, list);
  }
  return m;
}

// ---- Lumio's menu as Square items -------------------------------------------

/** Services not yet in Square's item library (by folded name), as catalog objects. */
export function menuToCatalog(services: { id: string; name: string; priceCents: number }[], existingNames: string[], currency: string) {
  const have = new Set(existingNames.map(fold));
  const objects: unknown[] = [];
  let i = 0;
  for (const s of services) {
    const k = fold(s.name);
    if (!k || have.has(k)) continue;
    have.add(k);
    i += 1;
    objects.push({
      type: 'ITEM',
      id: `#lumio-svc-${i}`,
      present_at_all_locations: true,
      item_data: {
        name: s.name.slice(0, 255),
        variations: [{
          type: 'ITEM_VARIATION',
          id: `#lumio-svc-${i}-v`,
          present_at_all_locations: true,
          item_variation_data: { item_id: `#lumio-svc-${i}`, name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: { amount: Math.max(0, Math.round(s.priceCents)), currency } },
        }],
      },
    });
  }
  return objects;
}
