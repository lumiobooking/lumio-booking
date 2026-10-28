/**
 * The header's booking inbox: what the front desk must act on or know about,
 * in three lists (the approved "Lịch — thông báo" canvas, board 2A):
 *
 *   needs      — a customer booked online / by chat / by the AI line and the
 *                salon has not confirmed it yet (Cần xác nhận)
 *   fresh      — other bookings customers made in the last 48 h (Mới đặt)
 *   cancelled  — bookings customers (or the AI / the system) cancelled in the
 *                last 48 h (Đã huỷ)
 *
 * A booking the salon typed in itself is never here: it is confirmed on the
 * spot (bookings.service deskConfirm) and the desk already knows about it.
 * Pure: the service runs the queries, this decides what belongs where.
 */

/** Sources that mean "the salon made it" — the front desk, a walk-in. */
export const DESK_SOURCES = ['admin', 'staff', 'manual', 'walkin', 'walk-in'];

export const isDeskSource = (s: string | null | undefined): boolean => DESK_SOURCES.includes(String(s ?? '').trim().toLowerCase());

/** Still waiting for the salon's yes. (REJECTED = a technician said no; the desk still has to decide.) */
export const NEEDS_STATUSES = ['PENDING', 'ASSIGNED', 'REJECTED'] as const;

/** How far back "Mới đặt" and "Đã huỷ" look. */
export const RECENT_MS = 48 * 3600_000;
/** A visit that started more than this long ago is no longer something to confirm. */
export const NEEDS_GRACE_MS = 60 * 60_000;

export interface InboxRow {
  id: string;
  status: string;
  source: string | null;
  utmSource?: string | null;
  attrReferrer?: string | null;
  attrLandingUrl?: string | null;
  startTime: Date;
  createdAt: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  priceCents: number;
  currency: string;
  addons: unknown;
  customer: { firstName: string; lastName: string | null } | null;
  service: { name: string } | null;
  assignedStaff: { firstName: string } | null;
}

export interface InboxItem {
  /** The booking — what "Xác nhận", "Từ chối" and "Xem lịch" act on. */
  id: string;
  status: string;
  customer: string;
  service: string;
  /** Add-on lines beyond the main service. */
  extra: number;
  startTime: string;
  staff: string | null;
  priceCents: number;
  currency: string;
  source: string | null;
  utmSource: string | null;
  attrReferrer: string | null;
  attrLandingUrl: string | null;
  /** When it happened: booked (needs / fresh) or cancelled. */
  at: string;
  cancelledBy?: string | null;
}

export interface Inbox {
  needs: InboxItem[];
  fresh: InboxItem[];
  cancelled: InboxItem[];
}

const nameOf = (c: InboxRow['customer']) => (c ? [c.firstName, c.lastName].filter(Boolean).join(' ').trim() : '') || 'Khách';

function item(r: InboxRow, at: Date): InboxItem {
  return {
    id: r.id,
    status: r.status,
    customer: nameOf(r.customer),
    service: r.service?.name ?? '',
    extra: Array.isArray(r.addons) ? r.addons.length : 0,
    startTime: r.startTime.toISOString(),
    staff: r.assignedStaff?.firstName ?? null,
    priceCents: r.priceCents,
    currency: r.currency,
    source: r.source ?? null,
    utmSource: r.utmSource ?? null,
    attrReferrer: r.attrReferrer ?? null,
    attrLandingUrl: r.attrLandingUrl ?? null,
    at: at.toISOString(),
    ...(r.cancelledAt ? { cancelledBy: r.cancelledBy ?? null } : {}),
  };
}

/**
 * Sort rows into the three lists. `open` = still-open customer bookings (any
 * creation date), `recent` = bookings created or cancelled in the window.
 */
export function buildInbox(open: InboxRow[], recent: InboxRow[], now: Date): Inbox {
  const needs = open
    .filter((r) => (NEEDS_STATUSES as readonly string[]).includes(r.status) && !isDeskSource(r.source) && r.startTime.getTime() >= now.getTime() - NEEDS_GRACE_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => item(r, r.createdAt));
  const needIds = new Set(needs.map((n) => n.id));
  const since = now.getTime() - RECENT_MS;
  const fresh = recent
    .filter((r) => r.createdAt.getTime() >= since && !isDeskSource(r.source) && !needIds.has(r.id) && r.status !== 'CANCELLED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => item(r, r.createdAt));
  // The desk cancelled it itself: nothing to tell the desk.
  const cancelled = recent
    .filter((r) => r.status === 'CANCELLED' && r.cancelledAt && r.cancelledAt.getTime() >= since && r.cancelledBy !== 'staff')
    .sort((a, b) => (b.cancelledAt as Date).getTime() - (a.cancelledAt as Date).getTime())
    .map((r) => item(r, r.cancelledAt as Date));
  return { needs: needs.slice(0, 50), fresh: fresh.slice(0, 50), cancelled: cancelled.slice(0, 50) };
}
