/**
 * THE ONE PLACE A TECHNICIAN'S SALES ARE ADDED UP.
 *
 * Payroll, the sales report, staff performance and the dashboard's "who is
 * selling" all read from this, so the same technician can never show one
 * number on one screen and another number on the next.
 *
 * Rules (each one fixed a real overpayment or a missing visit):
 *
 *  - A line's sale is its line total MINUS its share of the ticket's discount.
 *    A $10-off coupon (or loyalty points) on a $100 ticket is $90 of sales,
 *    split across the lines by their size. Paying commission on the $100 paid
 *    the techs for money the salon never took.
 *  - Tax is not a sale and tips are not a sale; tips are counted on their own.
 *  - The part of a tip paid by card is tracked (for the card-fee deduction):
 *    the card's share of what was actually tendered on that ticket.
 *  - A completed booking that was NOT checked out at the till still counts, at
 *    its price, for its technician — unless any paid ticket closed it, in any
 *    period (the caller passes those ids), so nothing is counted twice.
 *  - A visit is a ticket (or a booking), not a line: a gel manicure plus a
 *    nail-art add-on on one ticket is one visit for that tech.
 *  - Each sale is filed on the SALON's calendar day it was paid / completed.
 */

export type LineKind = 'SERVICE' | 'PRODUCT';

export interface LedgerOrder {
  id: string;
  paidAt: Date | null;
  discountCents: number;
  changeCents: number;
  giftCardAppliedCents: number;
  items: { kind: LineKind | string; quantity: number; lineTotalCents: number; tipCents: number; staffMemberId: string | null }[];
  tenders: { method: string; amountCents: number }[];
}

export interface LedgerAppointment {
  id: string;
  priceCents: number;
  assignedStaffId: string | null;
  completedAt: Date | null;
}

export interface DayBucket {
  serviceCents: number;
  productCents: number;
  serviceCount: number;
  tipsCents: number;
  cardTipsCents: number;
  visits: number;
}

export interface StaffLedger extends DayBucket {
  staffId: string; // 'unassigned' for lines nobody was credited with
  days: Record<string, DayBucket>;
}

export const UNASSIGNED = 'unassigned';

const blank = (): DayBucket => ({ serviceCents: 0, productCents: 0, serviceCount: 0, tipsCents: 0, cardTipsCents: 0, visits: 0 });

/**
 * Split `total` over `weights` in proportion, in whole cents, so the parts add
 * up to exactly `total` (largest-remainder; ties go to the earlier line).
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const t = Math.min(total, sum);
  const raw = weights.map((w) => (Math.max(0, w) * t) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = t - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

export function buildLedger(input: {
  orders: LedgerOrder[];
  appointments: LedgerAppointment[];
  /** Appointment ids closed by ANY paid ticket (not just those in range). */
  paidByTicket: Set<string>;
  dayOf: (at: Date) => string;
  /** Which drawer a tender method belongs to (pos/payment-methods bucketFor). */
  bucket: (method: string) => 'cash' | 'card' | 'other' | string;
}): Map<string, StaffLedger> {
  const rows = new Map<string, StaffLedger>();
  const row = (id: string | null) => {
    const key = id || UNASSIGNED;
    let r = rows.get(key);
    if (!r) { r = { staffId: key, ...blank(), days: {} }; rows.set(key, r); }
    return r;
  };
  const add = (r: StaffLedger, day: string, d: Partial<DayBucket>) => {
    const b = (r.days[day] ??= blank());
    for (const k of Object.keys(d) as (keyof DayBucket)[]) {
      const v = d[k] ?? 0;
      b[k] += v;
      r[k] += v;
    }
  };

  for (const o of input.orders) {
    if (!o.paidAt) continue;
    const day = input.dayOf(o.paidAt);
    const disc = allocate(o.discountCents ?? 0, o.items.map((l) => l.lineTotalCents));

    // Card share of what this ticket was actually paid with.
    let card = 0, other = 0, cash = 0;
    for (const t of o.tenders ?? []) {
      const b = input.bucket(t.method);
      if (b === 'card') card += t.amountCents;
      else if (b === 'cash') cash += t.amountCents;
      else other += t.amountCents;
    }
    const tendered = card + other + Math.max(0, cash - (o.changeCents ?? 0)) + (o.giftCardAppliedCents ?? 0);
    const cardShare = tendered > 0 ? Math.min(1, card / tendered) : 0;

    const visited = new Set<string>();
    o.items.forEach((l, i) => {
      const r = row(l.staffMemberId);
      const net = Math.max(0, l.lineTotalCents - disc[i]);
      const tip = l.tipCents ?? 0;
      const isService = String(l.kind).toUpperCase() === 'SERVICE';
      add(r, day, {
        serviceCents: isService ? net : 0,
        productCents: isService ? 0 : net,
        serviceCount: isService ? Math.max(1, l.quantity || 1) : 0,
        tipsCents: tip,
        cardTipsCents: Math.round(tip * cardShare),
      });
      if (isService && !visited.has(r.staffId)) {
        visited.add(r.staffId);
        add(r, day, { visits: 1 });
      }
    });
  }

  for (const a of input.appointments) {
    if (!a.completedAt || input.paidByTicket.has(a.id)) continue;
    const r = row(a.assignedStaffId);
    add(r, input.dayOf(a.completedAt), { serviceCents: a.priceCents ?? 0, serviceCount: 1, visits: 1 });
  }
  return rows;
}
