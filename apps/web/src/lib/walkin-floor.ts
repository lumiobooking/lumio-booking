/**
 * The walk-in floor in numbers — pure, shared by the stats strip and the
 * per-technician board, and tested in floor.spec.ts.
 */

export interface Leg { legId: string; status: 'WAITING' | 'SERVING' | 'DONE'; staffId: string | null; names: string[]; zone: 'HAND' | 'FOOT' | 'OTHER'; legacy?: boolean; lineIds: string[] }
export interface Item { lineId: string; name: string; priceCents: number; durationMinutes?: number }
export interface BoardWalkIn {
  id: string; customerName: string | null; partySize: number; status: string; createdAt: string; assignedAt: string | null;
  station: string | null; customerId: string | null; items: Item[]; service: { id: string; name: string } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null; legs?: Leg[]; phase?: string;
  /** The party this ticket belongs to (friends who came in together), or null. */
  group?: { tag: string; size: number; waiting: number; serving: number; done: number } | null;
  /** Finished in the chair: the bill is open, the technician is free. */
  awaitingPayment?: boolean;
}
export interface BoardStaff {
  id: string; name: string; turns: number; busy: boolean; nextUp: boolean; busyFor?: number | null;
  onBreak?: boolean;
  /** Place in the turn line (1 = next by the salon's rules); null = on a break / outside the rotation. */
  rank?: number | null;
  /** Only takes clients who ask for her by name (the owner outside the rotation). */
  manualOnly?: boolean;
  /** Her next booking today that has not started (ISO). */
  nextBookingAt?: string | null;
}
export interface BoardData {
  waiting: BoardWalkIn[]; serving: BoardWalkIn[]; staff: BoardStaff[]; nextUpStaffId: string | null;
  /** Finished today: how many and their services' money. */
  today?: { count: number; serviceCents: number };
  /** What each technician usually does: staffId → serviceIds, most frequent first. */
  frequent?: Record<string, string[]>;
}

/** Every technician keeps one colour, on this board and wherever else she appears. */
export const TECH_COLORS = ['#16a34a', '#ec4899', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6', '#a855f7', '#84cc16'];
export function techColor(staff: BoardStaff[], id: string | null | undefined): string {
  const i = staff.findIndex((s) => s.id === id);
  return TECH_COLORS[(i < 0 ? 0 : i) % TECH_COLORS.length];
}

/** Turns can be halves: 1.5 → "1½". */
export function fmtTurns(n: number): string {
  const whole = Math.floor(n + 1e-9);
  if (Math.abs(n - whole - 0.5) < 0.01) return whole ? `${whole}½` : '½';
  return String(Math.round(n * 100) / 100);
}
export const mins = (iso: string | null | undefined) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
/** Minutes after which a waiting customer is flagged. */
export const LONG_WAIT_MIN = 10;

/** Which technicians a ticket in a chair is with right now. */
export function techsOn(w: BoardWalkIn): string[] {
  const live = (w.legs ?? []).filter((l) => l.status === 'SERVING' && l.staffId).map((l) => l.staffId as string);
  if (live.length) return [...new Set(live)];
  if (w.phase === 'BETWEEN') return [];
  return w.assignedStaff ? [w.assignedStaff.id] : [];
}

/** The numbers a front desk wants first, and the longest wait (if too long). */
export function floorSummary(board: BoardData) {
  // One ticket, one place: waiting to pay is NOT in a chair (the technician is
  // free) — counting it as "Đang làm" made the top line say 17 while the
  // Đang làm column said 0.
  const toPayList = board.serving.filter((w) => w.awaitingPayment);
  const between = board.serving.filter((w) => !w.awaitingPayment && w.phase === 'BETWEEN');
  const inChair = board.serving.filter((w) => !w.awaitingPayment && w.phase !== 'BETWEEN').length;
  const free = board.staff.filter((s) => !s.busy && !s.onBreak).length;
  const onBreak = board.staff.filter((s) => s.onBreak && !s.busy).length;
  const missing = toPayList.filter((w) => (w.items ?? []).length === 0).length;
  const longest = [...board.waiting, ...between]
    .map((w) => ({ w, m: mins(w.phase === 'BETWEEN' ? (w.assignedAt ?? w.createdAt) : w.createdAt) }))
    .sort((a, b) => b.m - a.m)[0];
  const next = board.staff.find((s) => s.id === board.nextUpStaffId) ?? null;
  return {
    waiting: board.waiting.length, inChair, between: between.length, free, next,
    longest: longest && longest.m >= LONG_WAIT_MIN ? longest : null,
    longestMin: longest?.m ?? 0,
    toPay: toPayList.length, missing, onBreak,
    doneCount: board.today?.count ?? 0, doneCents: board.today?.serviceCents ?? 0,
  };
}

/** The turn line as the desk reads it: in the rules' order, then everyone outside it. */
export function turnLine<T extends BoardStaff>(staff: T[]): T[] {
  const ranked = staff.filter((s) => s.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return [...ranked, ...staff.filter((s) => s.rank == null)];
}

/**
 * One technician's state in a few words: up next, free, busy (and for how
 * long), a booking soon (within `soonMin`), on a break, request-only.
 * `bookingSoon` is the booking time when it is close enough to matter.
 */
export function techState(s: BoardStaff, now = Date.now(), soonMin = 90): { kind: 'next' | 'free' | 'busy' | 'break' | 'request'; busyFor: number | null; bookingSoon: string | null } {
  const at = s.nextBookingAt ? Date.parse(s.nextBookingAt) : NaN;
  const bookingSoon = Number.isFinite(at) && at - now >= 0 && at - now <= soonMin * 60000 ? (s.nextBookingAt as string) : null;
  const kind = s.busy ? 'busy' : s.onBreak ? 'break' : s.manualOnly ? 'request' : s.nextUp ? 'next' : 'free';
  return { kind, busyFor: s.busy ? (s.busyFor ?? null) : null, bookingSoon };
}

/** The technician a finished ticket belongs to (her last part), for "what she usually does". */
export function ticketTech(w: BoardWalkIn): string | null {
  const legs = (w.legs ?? []).filter((l) => l.staffId);
  if (legs.length) return legs[legs.length - 1].staffId;
  return w.assignedStaff?.id ?? null;
}


export interface TimelineLeg { legId: string; status: string; staffId: string | null; names: string[]; startedAt?: string | null; doneAt?: string | null }
export interface TimelineTicket { createdAt: string; arrivedAt?: string | null; assignedAt: string | null; awaitingPayment?: boolean; status: string; legs?: TimelineLeg[] }
export interface TimelineEvent { at: string; kind: 'in' | 'start' | 'done' | 'pay'; staffId: string | null; text: string[] }

/**
 * A ticket's story from its own fields — came in, each part started and
 * finished by whom, waiting to pay — oldest first. Nothing invented: a step
 * with no time is left out.
 */
export function ticketTimeline(w: TimelineTicket): TimelineEvent[] {
  const ev: TimelineEvent[] = [{ at: w.arrivedAt ?? w.createdAt, kind: 'in', staffId: null, text: [] }];
  for (const l of w.legs ?? []) {
    if (l.startedAt) ev.push({ at: l.startedAt, kind: 'start', staffId: l.staffId, text: l.names });
    if (l.doneAt) ev.push({ at: l.doneAt, kind: 'done', staffId: l.staffId, text: l.names });
  }
  if (!(w.legs ?? []).some((l) => l.startedAt) && w.assignedAt) ev.push({ at: w.assignedAt, kind: 'start', staffId: null, text: [] });
  if (w.awaitingPayment) {
    const last = [...ev].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    ev.push({ at: last.at, kind: 'pay', staffId: null, text: [] });
  }
  return ev.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === 'pay' ? 1 : b.kind === 'pay' ? -1 : 0));
}

/** For screens customers see: "Linda Pham" → "Linda P."; nothing → "Khách" / "Guest". */
export function shortName(full: string | null | undefined, vi: boolean): string {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return vi ? 'Khách' : 'Guest';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
