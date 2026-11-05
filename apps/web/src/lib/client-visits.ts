/**
 * A client's history as visits, for the client drawer: the appointments of one
 * day are one visit (a mani + a pedi is two appointments), and a till sale
 * with no appointment (a walk-in) is a visit of its own. Each visit knows the
 * services and technician it can be booked again with. Pure.
 */
import { dayKeyInTz } from './datetime';

export interface VisitAppt {
  id: string; status: string; startTime: string;
  serviceId?: string | null; assignedStaffId?: string | null;
  service: { name: string } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
  payments?: { amountCents: number; status: string }[];
}
export interface VisitOrder { id: string; createdAt: string; totalCents: number; appointmentId: string | null; items: { name: string; quantity: number; staffMemberId?: string | null }[] }
export interface Visit {
  key: string;
  at: string;
  /** "done" (finished or paid), "upcoming", "missed" (no-show / cancelled). */
  kind: 'done' | 'upcoming' | 'missed';
  status: string;
  lines: { name: string; staff: string | null }[];
  paidCents: number;
  /** What "Đặt lại" books: services still on the menu, with the technician. */
  rebook: { serviceId: string; staffId: string | null }[];
}

const DONE = new Set(['COMPLETED', 'PAID']);
const MISSED = new Set(['NO_SHOW', 'CANCELLED', 'REJECTED']);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

export function clientVisits(
  appts: VisitAppt[],
  orders: VisitOrder[],
  services: { id: string; name: string; isActive?: boolean }[],
  now: Date = new Date(),
  tz?: string,
): Visit[] {
  const live = new Map(services.filter((s) => s.isActive !== false).map((s) => [s.id, s]));
  const byName = new Map(services.filter((s) => s.isActive !== false).map((s) => [fold(s.name), s.id]));
  const staffName = (s: VisitAppt['assignedStaff']) => (s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : null);
  const groups = new Map<string, VisitAppt[]>();
  for (const a of appts) {
    const k = dayKeyInTz(new Date(a.startTime).getTime(), tz);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: Visit[] = [];
  for (const [day, list] of groups) {
    const sorted = [...list].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime));
    const future = Date.parse(sorted[0].startTime) > now.getTime() && !sorted.every((a) => MISSED.has(a.status));
    const kind: Visit['kind'] = sorted.some((a) => DONE.has(a.status)) ? 'done' : future ? 'upcoming' : sorted.every((a) => MISSED.has(a.status)) ? 'missed' : 'done';
    const kept = sorted.filter((a) => !MISSED.has(a.status) || sorted.every((b) => MISSED.has(b.status)));
    out.push({
      key: `a:${day}:${sorted[0].id}`,
      at: sorted[0].startTime,
      kind,
      status: sorted.find((a) => !MISSED.has(a.status))?.status ?? sorted[0].status,
      lines: kept.map((a) => ({ name: a.service?.name ?? '—', staff: staffName(a.assignedStaff) })),
      paidCents: sorted.reduce((n, a) => n + (a.payments ?? []).filter((p) => p.status === 'PAID').reduce((m, p) => m + p.amountCents, 0), 0),
      rebook: kept.filter((a) => a.serviceId && live.has(a.serviceId)).map((a) => ({ serviceId: a.serviceId as string, staffId: a.assignedStaffId ?? null })),
    });
  }
  // Walk-ins and counter sales: the order is the visit (one with an appointment is already above).
  for (const o of orders.filter((x) => !x.appointmentId)) {
    out.push({
      key: `o:${o.id}`,
      at: o.createdAt,
      kind: 'done',
      status: 'PAID',
      lines: o.items.map((i) => ({ name: i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name, staff: null })),
      paidCents: o.totalCents,
      rebook: o.items.map((i) => ({ serviceId: byName.get(fold(i.name)) ?? '', staffId: i.staffMemberId ?? null })).filter((x) => x.serviceId),
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
