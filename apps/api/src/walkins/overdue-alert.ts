/**
 * THE DESK HEARS ABOUT A LATE CHAIR. The board already paints a visit amber
 * at +15′ and the sweeper parks it at the till at +45′, but a receptionist
 * looking at the POS or the phone missed both. Now the desk's phones buzz:
 *   - once per visit when it first runs LATE_WARN_MIN past its expected end;
 *   - when the sweeper moves visits to "waiting to pay".
 * Only the people who run the floor are woken: the owner and staff whose
 * login can open the walk-in board — never the technicians' own phones.
 * Pure.
 */
import { UserRole, StaffRole } from '@prisma/client';
import { capabilitiesFor } from '../auth/capabilities';
import { LATE_WARN_MIN, STALE_GRACE_MIN, TicketLike, overdueMinutes } from './walkin-legs';

export type NamedTicket = TicketLike & { customerName?: string | null };
export interface LateOne { id: string; name: string; over: number }

/** Setting key holding the ids already warned (newest last, capped). */
export const LATE_WARNED_KEY = 'walkin_late_warned';
const KEEP = 300;

const nameOf = (t: NamedTicket) => (t.customerName || '').trim() || 'Walk-in';

/** Visits that just crossed +15′ (and are not yet due to be parked), not warned before. */
export function newlyLate(tickets: NamedTicket[], now: Date, warned: string[]): LateOne[] {
  const seen = new Set(warned);
  const out: LateOne[] = [];
  for (const t of tickets) {
    if (seen.has(t.id)) continue;
    const over = overdueMinutes(t, now);
    if (over === null || over < LATE_WARN_MIN || over >= STALE_GRACE_MIN) continue;
    out.push({ id: t.id, name: nameOf(t), over });
  }
  return out.sort((a, b) => b.over - a.over);
}

export function rememberWarned(prev: unknown, add: string[]): string[] {
  const list = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string') : [];
  const merged = [...list.filter((x) => !add.includes(x)), ...add];
  return merged.slice(-KEEP);
}

const names = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '');

export function lateAlert(late: LateOne[]): { title: string; body: string; url: string; tag: string } | null {
  if (!late.length) return null;
  return {
    title: `⏰ Khách quá giờ · Running late (${late.length})`,
    body: late.slice(0, 3).map((l) => `${l.name} +${l.over}′`).join(' · ') + (late.length > 3 ? ` +${late.length - 3}` : ''),
    url: '/salon/front-desk',
    tag: 'walkin-late',
  };
}

export function parkedAlert(parkedNames: string[]): { title: string; body: string; url: string; tag: string } | null {
  if (!parkedNames.length) return null;
  return {
    title: `💳 Chuyển sang chờ tính tiền · Moved to pay (${parkedNames.length})`,
    body: `${names(parkedNames)} — quá giờ, đã giải phóng ghế · overdue, chair freed`,
    url: '/salon/front-desk',
    tag: 'walkin-parked',
  };
}

/** Who runs the floor: the owner(s), and staff logins that can open the walk-in board (not technicians). */
export function deskUserIds(
  admins: { id: string }[],
  staff: { userId: string | null; staffRole: string | null; permissions?: unknown }[],
): string[] {
  const ids = new Set(admins.map((a) => a.id));
  for (const s of staff) {
    if (!s.userId || !s.staffRole || s.staffRole === 'TECHNICIAN') continue;
    if (capabilitiesFor(UserRole.STAFF, s.staffRole as StaffRole, s.permissions).includes('walkins')) ids.add(s.userId);
  }
  return [...ids];
}
