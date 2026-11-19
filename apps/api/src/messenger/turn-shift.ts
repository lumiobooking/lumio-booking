/**
 * Chia turn — "Vào ca / Ra ca" in Lumio itself (rt198, 19/11/2026).
 *
 * The owner's words: a team member presses ONE button at the start of the
 * shift and the phone rings when a customer is given to them. No daily
 * Messenger message, no keeping the app open.
 *
 *  - On shift (pressed "Vào ca", not yet "Ra ca", not past its end) counts as
 *    present for the rotation, app open or not — the phone is reached by push.
 *  - The shift ends by itself: at the end of today's working hours (+30 min)
 *    when the person has hours on file, else 12 hours after pressing.
 *    Nobody forgets to press "Ra ca" and keeps getting customers at midnight.
 *  - A customer not opened after a minute rings the phone a second time.
 *  - A customer still waiting at the salon's alarm minute is offered to
 *    everyone on shift ("ai rảnh nhận giúp") as well as the owner, and any of
 *    them may take it.
 *
 * Stored one setting row per person (`messenger.turn_shift.<userId>`) so two
 * people pressing at the same moment can never overwrite each other.
 */

export const SHIFT_PREFIX = 'messenger.turn_shift.';
export const shiftKey = (userId: string) => `${SHIFT_PREFIX}${userId}`;

export type Shift = { on: boolean; at: string; until: string | null };

export function cleanShift(raw: unknown): Shift | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Partial<Shift> | null;
  if (!o || typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null;
  const until = typeof o.until === 'string' && !Number.isNaN(Date.parse(o.until)) ? o.until : null;
  return { on: o.on === true, at: o.at, until };
}

/** Pressed "Vào ca", not "Ra ca", and the shift has not run out. */
export function shiftActive(s: Shift | null | undefined, now: Date): boolean {
  if (!s?.on) return false;
  return !s.until || Date.parse(s.until) > now.getTime();
}

/** On, but its time has run out: the minute should close it. */
export function shiftExpired(s: Shift | null | undefined, now: Date): boolean {
  return !!s?.on && !!s.until && Date.parse(s.until) <= now.getTime();
}

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * When a shift started now ends by itself. `clock` is the salon's weekday and
 * minutes past midnight; `hours` the person's working hours on file.
 * Today's hours that have not ended yet → their end + 30 min. Otherwise 12 h.
 * Never more than 16 h.
 */
export function shiftUntil(now: Date, clock: { weekday: number; minutes: number } | null, hours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[]): Date {
  const fallback = new Date(now.getTime() + 12 * 3600_000);
  if (!clock) return fallback;
  const ends = hours
    .filter((h) => h.isActive !== false && h.dayOfWeek === clock.weekday)
    .map((h) => toMin(h.endTime))
    .filter((m) => Number.isFinite(m) && m + 30 > clock.minutes);
  if (!ends.length) return fallback;
  const mins = Math.max(...ends) + 30 - clock.minutes;
  return new Date(now.getTime() + Math.min(16 * 60, mins) * 60_000);
}

/**
 * Ring a second time? Given to someone 60–120 s ago (the minute tick lands in
 * that window once), not opened since, nobody answered since.
 */
export function remindDue(t: { status?: string; assignedUserId?: string | null; assignedAt?: Date | string | null; readAt?: Date | string | null; handoffAt?: Date | string | null }, now: Date): boolean {
  if ((t.status ?? 'open') !== 'open' || !t.assignedUserId || !t.assignedAt) return false;
  const at = new Date(t.assignedAt).getTime();
  const age = now.getTime() - at;
  if (!(age >= 60_000 && age < 120_000)) return false;
  const after = (d: Date | string | null | undefined) => !!d && new Date(d).getTime() >= at;
  return !after(t.readAt) && !after(t.handoffAt);
}

/**
 * The customer has waited past the alarm and is still waiting: anyone on the
 * team may take the conversation, whoever holds it.
 */
export function rescueOpen(t: { escalatedAt?: Date | string | null; lastCustomerAt?: Date | string | null; handoffAt?: Date | string | null }): boolean {
  if (!t.escalatedAt || !t.lastCustomerAt) return false;
  const esc = new Date(t.escalatedAt).getTime();
  const cust = new Date(t.lastCustomerAt).getTime();
  if (esc < cust) return false;
  return !t.handoffAt || new Date(t.handoffAt).getTime() < cust;
}

/** "tới 18:30" in the salon's time. */
export function untilLabel(until: string | null, timeZone: string): string {
  if (!until) return '';
  try { return new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(until)); } catch { return ''; }
}
