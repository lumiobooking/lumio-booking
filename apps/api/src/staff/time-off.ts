/**
 * NGHỈ PHÉP — pure rules for approved time off.
 *
 * An approved request is a block on the technician's time: whole salon days
 * (startDate..endDate, inclusive) or one part of a single day (startTime..
 * endTime on startDate). Everything that decides "is she available?" asks
 * here — the assignment engine, the online booking page, the desk's open
 * times, the party planner — so a day off is a day off everywhere at once.
 * Payroll reads the whole-day blocks as days off.
 */
import { wallTimeToUtcTz } from '../common/salon-time';

export interface TimeOffLite {
  staffId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startTime?: string | null; // HH:mm — with endTime, part of startDate only
  endTime?: string | null;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function hmToMinutes(hm: string): number {
  const m = HM_RE.exec(hm);
  return m ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : NaN;
}

/** Is this a part-of-one-day block? */
export function isPartial(o: TimeOffLite): boolean {
  return !!o.startTime && !!o.endTime && o.startDate === o.endDate;
}

/** Does the block cover this salon day at all? */
export function coversDay(o: TimeOffLite, day: string): boolean {
  return o.startDate <= day && day <= o.endDate;
}

/**
 * Does the block take the slot [startMin, endMin) of salon day `day`?
 * Whole-day blocks take everything on their days; a partial one only its hours.
 */
export function blocksSlot(o: TimeOffLite, day: string, startMin: number, endMin: number): boolean {
  if (!coversDay(o, day)) return false;
  if (!isPartial(o)) return true;
  const s = hmToMinutes(o.startTime!);
  const e = hmToMinutes(o.endTime!);
  if (Number.isNaN(s) || Number.isNaN(e)) return true; // malformed → safest is "off"
  return s < endMin && startMin < e;
}

/** The blocks on one salon day as UTC busy spans, the shape availability already uses. */
export function busySpansFor(offs: TimeOffLite[], staffId: string, day: string, tz: string): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const dayStart = wallTimeToUtcTz(day, '00:00', tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
  for (const o of offs) {
    if (o.staffId !== staffId || !coversDay(o, day)) continue;
    if (!isPartial(o)) { out.push({ start: dayStart, end: dayEnd }); continue; }
    const s = wallTimeToUtcTz(day, o.startTime!, tz);
    const e = wallTimeToUtcTz(day, o.endTime!, tz);
    if (e.getTime() > s.getTime()) out.push({ start: s, end: e });
  }
  return out;
}

/** Whole days off per technician inside [from, to] — what payroll marks as off. */
export function wholeDaysOff(offs: TimeOffLite[], from: string, to: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const o of offs) {
    if (isPartial(o)) continue;
    const days = out.get(o.staffId) ?? [];
    let d = o.startDate < from ? from : o.startDate;
    const last = o.endDate > to ? to : o.endDate;
    let guard = 0;
    while (d <= last && guard++ < 400) {
      if (!days.includes(d)) days.push(d);
      d = nextDay(d);
    }
    out.set(o.staffId, days);
  }
  return out;
}

/** Do two requests of the same technician overlap in time? */
export function overlaps(a: TimeOffLite, b: TimeOffLite): boolean {
  if (a.staffId !== b.staffId) return false;
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  if (isPartial(a) && isPartial(b)) {
    return hmToMinutes(a.startTime!) < hmToMinutes(b.endTime!) && hmToMinutes(b.startTime!) < hmToMinutes(a.endTime!);
  }
  return true;
}

/** A request as typed; the reason it is refused, or null. Whole days or one part of a day. */
export function validateRequest(r: { startDate: string; endDate: string; startTime?: string | null; endTime?: string | null }, today: string): string | null {
  if (!DAY_RE.test(r.startDate) || !DAY_RE.test(r.endDate)) return 'Dates must be YYYY-MM-DD';
  if (r.endDate < r.startDate) return 'The last day must not be before the first';
  if (r.endDate < today) return 'That time is already past';
  if (daysBetween(r.startDate, r.endDate) > 92) return 'At most 3 months at a time';
  const partial = !!(r.startTime || r.endTime);
  if (partial) {
    if (!r.startTime || !r.endTime || !HM_RE.test(r.startTime) || !HM_RE.test(r.endTime)) return 'Times must be HH:mm';
    if (r.startDate !== r.endDate) return 'A part of a day is one day only';
    if (hmToMinutes(r.endTime) <= hmToMinutes(r.startTime)) return 'The end must be after the start';
  }
  return null;
}

export function nextDay(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/**
 * The APPROVED blocks of one salon that touch [from, to]. The loader every
 * availability path shares; `db` is the Prisma client (typed loosely because
 * the model is newer than some generated clients). Never throws: a salon
 * with no table yet simply has nobody on leave.
 */
export async function loadApprovedTimeOff(db: unknown, tenantId: string, from: string, to: string, staffIds?: string[]): Promise<TimeOffLite[]> {
  if (!tenantId) return [];
  try {
    const rows: TimeOffLite[] = await (db as any).timeOffRequest.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
      where: { tenantId, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from }, ...(staffIds ? { staffId: { in: staffIds } } : {}) },
      select: { staffId: true, startDate: true, endDate: true, startTime: true, endTime: true },
      take: 1000,
    });
    return rows;
  } catch { return []; }
}
