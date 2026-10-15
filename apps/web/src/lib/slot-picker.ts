/**
 * What the booking form's time picker offers: only days the salon is open and
 * only times inside opening hours, never a time already gone (unless the desk
 * is recording a customer who is already in the chair).
 *
 * The browser's own date-time picker offered every minute of every day —
 * 4:30 AM, last Tuesday, a Sunday the salon is shut — and left the desk to
 * guess which were real. Everything here is on the SALON's wall clock
 * ("YYYY-MM-DDTHH:mm"), the same value the form already sends.
 */
import { windowsForDay, wallParts, type HoursRules } from './desk-hours';

export const SLOT_STEP = 15;
/** How far back the desk may record a booking (the server allows the same). */
export const PAST_LIMIT_MIN = 12 * 60;

export interface DayOption { ymd: string; weekday: number; d: number; mo: number; open: boolean; reason?: 'dayOff' | 'closed' }

const pad = (n: number) => String(n).padStart(2, '0');
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function hasHours(rules: HoursRules | null | undefined): boolean {
  return Array.isArray(rules?.businessHours) && rules!.businessHours!.length === 7;
}

/** The next `n` days from today, each marked open or not. */
export function dayOptions(todayYmd: string, rules: HoursRules | null | undefined, n = 14): DayOption[] {
  const off = new Set(rules?.daysOff ?? []);
  return Array.from({ length: n }, (_, i) => {
    const ymd = addDaysYmd(todayYmd, i);
    const p = wallParts(`${ymd}T00:00`)!;
    const base = { ymd, weekday: p.weekday, d: p.d, mo: p.mo };
    if (off.has(ymd)) return { ...base, open: false, reason: 'dayOff' as const };
    if (hasHours(rules) && !windowsForDay(rules!.businessHours![p.weekday]).length) return { ...base, open: false, reason: 'closed' as const };
    return { ...base, open: true };
  });
}

/**
 * Start times (minutes after midnight) the salon takes on that day: every
 * 15 minutes from opening until closing (a start, not an end — a service may
 * run a little past closing, which is the salon's call, as on the server).
 * Today drops the times already gone; `showPast` brings back the last 12 hours
 * of them for a customer who is already here.
 */
export function slotsForDay(ymd: string, rules: HoursRules | null | undefined, opts: { nowWall: string; showPast?: boolean; step?: number }): { min: number; past: boolean }[] {
  if (!hasHours(rules) || (rules?.daysOff ?? []).includes(ymd)) return [];
  const p = wallParts(`${ymd}T00:00`)!;
  const step = opts.step ?? SLOT_STEP;
  const now = wallParts(opts.nowWall);
  const out: { min: number; past: boolean }[] = [];
  for (const w of windowsForDay(rules!.businessHours![p.weekday])) {
    for (let m = Math.ceil(w.open / step) * step; m < w.close; m += step) {
      let past = false;
      if (now) {
        if (ymd < now.ymd) past = true;
        else if (ymd === now.ymd) past = m < now.minutes;
      }
      if (past) {
        if (!opts.showPast || !now) continue;
        const ago = (ymd === now.ymd ? now.minutes - m : now.minutes + 24 * 60 - m);
        if (ago > PAST_LIMIT_MIN) continue;
      }
      out.push({ min: m, past });
    }
  }
  return out;
}

/** The first open day from today that still has a time left. */
export function firstOpenDay(todayYmd: string, rules: HoursRules | null | undefined, nowWall: string, n = 14): string | null {
  for (const d of dayOptions(todayYmd, rules, n)) {
    if (d.open && slotsForDay(d.ymd, rules, { nowWall }).length) return d.ymd;
  }
  return null;
}

export const wallOf = (ymd: string, min: number) => `${ymd}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
