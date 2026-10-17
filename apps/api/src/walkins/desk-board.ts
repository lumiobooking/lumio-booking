/**
 * WALK-IN 2.0 — what the front desk sees at a glance. Pure.
 *
 * The board already knew who is busy and who is up next; the desk asked for
 * the rest of the picture: the whole line in turn order (not just #1), which
 * technician has a booking coming up, what each technician usually does (so a
 * finished ticket with no service is fixed in one tap), and today's totals.
 * Nothing here changes who gets a customer — the order is the salon's own
 * turn rules, asked one technician at a time.
 */
import { pickTech, type PickOptions, type TechInfo } from './walkin-legs';

/**
 * The line in turn order: who the rules would pick first, then second… among
 * everyone in the rotation (busy or not — a busy technician keeps her place).
 * Technicians on a break, or outside the rotation, are left out.
 */
export function turnOrder(techs: TechInfo[], turns: Map<string, number>, opts: PickOptions, exclude: Set<string>): string[] {
  let pool = techs.filter((t) => !exclude.has(t.id));
  const out: string[] = [];
  while (pool.length) {
    const next = pickTech(pool, [], turns, opts);
    if (!next) break;
    out.push(next.id);
    pool = pool.filter((t) => t.id !== next.id);
  }
  return out;
}

/** Each technician's next booking today that has not started yet (ISO), earliest first. */
export function nextBookingByStaff(booked: { startTime: Date | string; staffId: string | null }[], now: Date): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of booked) {
    if (!b.staffId) continue;
    const at = new Date(b.startTime);
    if (at.getTime() < now.getTime()) continue;
    const cur = out.get(b.staffId);
    if (!cur || at.getTime() < Date.parse(cur)) out.set(b.staffId, at.toISOString());
  }
  return out;
}

interface DoneRow { assignedStaffId: string | null; items: unknown }
interface LineLike { serviceId?: string | null; staffId?: string | null; priceCents?: number }
const linesOf = (r: { items: unknown }): LineLike[] => (Array.isArray(r.items) ? (r.items as LineLike[]) : []);

/**
 * What each technician usually does — the services on her recent finished
 * tickets, most frequent first (ties: most recent first), at most `top`.
 * A line names its own technician; an old line without one belongs to the
 * ticket's technician.
 */
export function frequentServices(rows: DoneRow[], top = 4): Record<string, string[]> {
  const counts = new Map<string, Map<string, { n: number; first: number }>>();
  rows.forEach((r, order) => {
    for (const l of linesOf(r)) {
      const staffId = l.staffId || r.assignedStaffId;
      if (!staffId || !l.serviceId) continue;
      const m = counts.get(staffId) ?? new Map<string, { n: number; first: number }>();
      const c = m.get(l.serviceId) ?? { n: 0, first: order };
      c.n += 1;
      m.set(l.serviceId, c);
      counts.set(staffId, m);
    }
  });
  const out: Record<string, string[]> = {};
  for (const [staffId, m] of counts) {
    out[staffId] = [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, top).map(([id]) => id);
  }
  return out;
}

/** Today's finished visits: how many, and what their services add up to. */
export function todayTotals(done: { items: unknown }[]): { count: number; serviceCents: number } {
  let serviceCents = 0;
  for (const r of done) for (const l of linesOf(r)) serviceCents += Math.max(0, Number(l.priceCents) || 0);
  return { count: done.length, serviceCents };
}

/** Why a visit was closed without a receipt — a short list, so the end-of-day check can count them. */
export const CLOSE_UNPAID_REASONS = ['paid_elsewhere', 'pay_later', 'free_redo', 'mistake', 'other'] as const;
export type CloseUnpaidReason = (typeof CLOSE_UNPAID_REASONS)[number];
export function cleanCloseReason(v: unknown): CloseUnpaidReason {
  return (CLOSE_UNPAID_REASONS as readonly string[]).includes(String(v)) ? (v as CloseUnpaidReason) : 'other';
}
