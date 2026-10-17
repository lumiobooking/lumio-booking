/**
 * WALK-IN 2.0, STEP 3 — "Đối soát cuối ngày". Pure.
 *
 * Before the salon calls it a day: which visits are still open, which wait
 * at the till, which have no service, what was closed without a receipt and
 * why, and every time the desk seated someone other than the suggestion.
 * Plus the day's numbers. Read from the day's tickets and audit rows only —
 * nothing is changed here.
 */
import { hasService } from './desk-policy';

export interface ReviewTicket {
  id: string; status: string; customerName: string | null; awaitingPayment?: boolean;
  createdAt: Date | string; assignedAt: Date | string | null; doneAt: Date | string | null;
  assignedStaffId: string | null; serviceId?: string | null; items: unknown;
}
export interface ClosedUnpaid { walkInId: string; reason: string | null; note: string | null; at: Date | string; userId: string | null }
export interface Override { walkInId: string; suggested: string | null; chosen: string | null; reason: string | null; at: Date | string; userId: string | null }

export type IssueKind = 'open' | 'unpaid' | 'no_service';
export interface Issue { id: string; kind: IssueKind; name: string; staffId: string | null; amountCents: number; since: string }

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);
const lines = (items: unknown) => (Array.isArray(items) ? (items as { priceCents?: number; startedAt?: string | null; staffId?: string | null }[]) : []);
const amount = (t: ReviewTicket) => lines(t.items).reduce((s, l) => s + Math.max(0, Number(l.priceCents) || 0), 0);
const lastStaff = (t: ReviewTicket) => [...lines(t.items)].reverse().find((l) => l.staffId)?.staffId ?? t.assignedStaffId;

/** Minutes from coming in to the first technician starting (null when never seated). */
export function waitedMinutes(t: ReviewTicket): number | null {
  const starts = lines(t.items).map((l) => ms(l.startedAt)).filter((x) => Number.isFinite(x));
  const start = starts.length ? Math.min(...starts) : ms(t.assignedAt);
  const came = ms(t.createdAt);
  if (!Number.isFinite(start) || !Number.isFinite(came) || start < came) return null;
  return Math.round((start - came) / 60000);
}

export function dayReview(input: { tickets: ReviewTicket[]; settledIds: Set<string>; closedUnpaid: ClosedUnpaid[]; overrides: Override[]; noShowIds?: Set<string> }) {
  const closedIds = new Set(input.closedUnpaid.map((c) => c.walkInId));
  const issues: Issue[] = [];
  let done = 0; let cancelled = 0; let serviceCents = 0;
  const waits: number[] = [];
  for (const t of input.tickets) {
    const name = (t.customerName || '').trim() || 'Walk-in';
    const base = { id: t.id, name, staffId: lastStaff(t), amountCents: amount(t) };
    const service = hasService(t.items) || Boolean(t.serviceId);
    if (t.status === 'CANCELLED') { cancelled++; continue; }
    const w = waitedMinutes(t);
    if (w != null) waits.push(w);
    if (t.status === 'WAITING' || (t.status === 'SERVING' && !t.awaitingPayment)) {
      issues.push({ ...base, kind: 'open', since: new Date(t.createdAt).toISOString() });
      continue;
    }
    if (!service && !closedIds.has(t.id)) {
      issues.push({ ...base, kind: 'no_service', since: new Date(t.doneAt ?? t.assignedAt ?? t.createdAt).toISOString() });
      continue;
    }
    if (t.awaitingPayment && !input.settledIds.has(t.id) && !closedIds.has(t.id)) {
      issues.push({ ...base, kind: 'unpaid', since: new Date(t.doneAt ?? t.assignedAt ?? t.createdAt).toISOString() });
    }
    if (t.status === 'DONE') { done++; serviceCents += base.amountCents; }
  }
  const order: Record<IssueKind, number> = { no_service: 0, unpaid: 1, open: 2 };
  issues.sort((a, b) => order[a.kind] - order[b.kind] || a.since.localeCompare(b.since));
  return {
    issues,
    totals: {
      tickets: input.tickets.length, done, cancelled,
      noShows: input.noShowIds ? input.tickets.filter((t) => input.noShowIds!.has(t.id)).length : 0,
      serviceCents,
      avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      longestWaitMin: waits.length ? Math.max(...waits) : null,
    },
    closedUnpaid: [...input.closedUnpaid].sort((a, b) => ms(a.at) - ms(b.at)),
    overrides: [...input.overrides].sort((a, b) => ms(a.at) - ms(b.at)),
  };
}
