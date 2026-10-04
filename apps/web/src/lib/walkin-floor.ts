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
}
export interface BoardStaff { id: string; name: string; turns: number; busy: boolean; nextUp: boolean; busyFor?: number | null }
export interface BoardData { waiting: BoardWalkIn[]; serving: BoardWalkIn[]; staff: BoardStaff[]; nextUpStaffId: string | null }

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
  const between = board.serving.filter((w) => w.phase === 'BETWEEN');
  const inChair = board.serving.length - between.length;
  const free = board.staff.filter((s) => !s.busy).length;
  const longest = [...board.waiting, ...between]
    .map((w) => ({ w, m: mins(w.phase === 'BETWEEN' ? (w.assignedAt ?? w.createdAt) : w.createdAt) }))
    .sort((a, b) => b.m - a.m)[0];
  const next = board.staff.find((s) => s.id === board.nextUpStaffId) ?? null;
  return { waiting: board.waiting.length, inChair, between: between.length, free, next, longest: longest && longest.m >= LONG_WAIT_MIN ? longest : null };
}

