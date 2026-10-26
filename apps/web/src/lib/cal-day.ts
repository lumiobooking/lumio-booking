/**
 * THE DAY ON THE CALENDAR, AS THE FRONT DESK READS IT.
 *
 * The redesigned calendar ("List" view, the date strip, the Filters panel and
 * the right-hand rail) all ask the same questions of one day of bookings:
 * which state is each one in, what still needs someone, how full is the day,
 * which bookings survive the filters, and how many each filter option would
 * leave. One pure module answers them, so the list, the rail, the strip and
 * the filter counts can never disagree — and every rule here is tested
 * (cal-day.spec.ts).
 *
 * Nothing here knows about React, the API or the theme.
 */
import { srcKey, type SourceKey } from './booking-sources';

/** The seven states a row can show. `late` = still open, past its start. */
export type ListKey = 'pending' | 'confirmed' | 'late' | 'arrived' | 'completed' | 'noshow' | 'cancelled';
export const LIST_KEYS: ListKey[] = ['pending', 'confirmed', 'late', 'arrived', 'completed', 'noshow', 'cancelled'];

/** A booking is "not arrived" this many minutes after its start. */
export const LATE_AFTER_MIN = 10;

const OPEN = new Set(['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED']);
const PENDING = new Set(['PENDING', 'ASSIGNED', 'REJECTED']);

export interface DayBooking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  priceCents: number;
  assignedStaff?: { id: string } | null;
  service?: { durationMinutes?: number } | null;
  source?: string | null;
  utmSource?: string | null;
  attrReferrer?: string | null;
  attrLandingUrl?: string | null;
}

export const isOpen = (status: string) => OPEN.has(status);
export const isGone = (status: string) => status === 'CANCELLED' || status === 'NO_SHOW';

/** Minutes past the start of a still-open booking, once it counts as late; else null. */
export function lateMinutes(b: Pick<DayBooking, 'status' | 'startTime'>, now = Date.now()): number | null {
  if (!OPEN.has(b.status)) return null;
  const m = Math.floor((now - new Date(b.startTime).getTime()) / 60000);
  return m >= LATE_AFTER_MIN ? m : null;
}

export function listKey(b: Pick<DayBooking, 'status' | 'startTime'>, now = Date.now()): ListKey {
  switch (b.status) {
    case 'CANCELLED': return 'cancelled';
    case 'NO_SHOW': return 'noshow';
    case 'COMPLETED': return 'completed';
    case 'ARRIVED': return 'arrived';
    default:
      if (lateMinutes(b, now) !== null) return 'late';
      return PENDING.has(b.status) ? 'pending' : 'confirmed';
  }
}

export function durationMin(b: Pick<DayBooking, 'startTime' | 'endTime' | 'service'>): number {
  const d = Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000);
  return d > 0 ? d : Math.max(0, b.service?.durationMinutes ?? 0);
}

/** 0 = morning (before noon), 1 = afternoon (before 5 PM), 2 = evening. */
export function periodOf(minuteOfDay: number): 0 | 1 | 2 {
  return minuteOfDay < 12 * 60 ? 0 : minuteOfDay < 17 * 60 ? 1 : 2;
}

// ── what needs someone ─────────────────────────────────────────────────────

export type AttentionKind = 'late' | 'pending' | 'unassigned';

/**
 * The one thing a booking is waiting on, if any. Late beats pending beats
 * unassigned: a customer standing at the door matters more than paperwork.
 * Past bookings that were never confirmed are not "attention" — they are late.
 */
export function attentionOf(b: DayBooking, now = Date.now()): AttentionKind | null {
  if (!OPEN.has(b.status)) return null;
  if (lateMinutes(b, now) !== null) return 'late';
  if (PENDING.has(b.status)) return 'pending';
  if (!b.assignedStaff) return 'unassigned';
  return null;
}

/** An open booking that has no technician yet (any time of the day). */
export const isUnassigned = (b: DayBooking) => OPEN.has(b.status) && !b.assignedStaff;

// ── filters ────────────────────────────────────────────────────────────────

export type Preset = 'attention' | 'unassigned' | 'online' | 'upcoming';
export const PRESETS: Preset[] = ['attention', 'unassigned', 'online', 'upcoming'];

/** Sources a customer used by themselves, online — not typed in by the salon. */
const OFFLINE: SourceKey[] = ['staff', 'walkin', 'hotline'];

export interface CalFilters {
  sources: SourceKey[];
  /** Staff ids; '__un' = no technician. */
  staff: string[];
  statuses: ListKey[];
  preset: Preset | null;
}
export const NO_FILTERS: CalFilters = { sources: [], staff: [], statuses: [], preset: null };

export function activeFilterCount(f: CalFilters): number {
  return f.sources.length + f.staff.length + f.statuses.length + (f.preset ? 1 : 0);
}

export function matchPreset(b: DayBooking, p: Preset, now = Date.now()): boolean {
  switch (p) {
    case 'attention': return attentionOf(b, now) !== null;
    case 'unassigned': return isUnassigned(b);
    case 'online': return !OFFLINE.includes(srcKey(b));
    case 'upcoming': return OPEN.has(b.status) && new Date(b.startTime).getTime() > now;
    default: return true;
  }
}

type Group = 'sources' | 'staff' | 'statuses' | 'preset';

function passes(b: DayBooking, f: CalFilters, now: number, skip?: Group): boolean {
  if (skip !== 'sources' && f.sources.length && !f.sources.includes(srcKey(b))) return false;
  if (skip !== 'staff' && f.staff.length && !f.staff.includes(b.assignedStaff?.id ?? '__un')) return false;
  if (skip !== 'statuses' && f.statuses.length && !f.statuses.includes(listKey(b, now))) return false;
  if (skip !== 'preset' && f.preset && !matchPreset(b, f.preset, now)) return false;
  return true;
}

/** Inside a group the choices are OR ("Facebook or Instagram"); groups are AND. */
export function applyFilters<T extends DayBooking>(rows: T[], f: CalFilters, now = Date.now()): T[] {
  if (!activeFilterCount(f)) return rows;
  return rows.filter((b) => passes(b, f, now));
}

export interface FacetCounts {
  sources: Partial<Record<SourceKey, number>>;
  staff: Record<string, number>;
  statuses: Partial<Record<ListKey, number>>;
  presets: Record<Preset, number>;
}

/**
 * How many bookings each option would show, given the OTHER groups' picks —
 * so ticking "Google Maps" makes the technician counts say how many of those
 * Google bookings each tech has, and the counts never promise an empty list.
 */
export function facetCounts(rows: DayBooking[], f: CalFilters, now = Date.now(), opts: { hideCancelled?: boolean } = {}): FacetCounts {
  const out: FacetCounts = { sources: {}, staff: {}, statuses: {}, presets: { attention: 0, unassigned: 0, online: 0, upcoming: 0 } };
  for (const b of rows) {
    // Cancelled bookings are off the list until "Cancelled" is ticked, so the
    // other counts leave them out too — a count must match what the list shows.
    if (opts.hideCancelled && b.status === 'CANCELLED') {
      if (passes(b, f, now, 'statuses')) out.statuses.cancelled = (out.statuses.cancelled ?? 0) + 1;
      continue;
    }
    if (passes(b, f, now, 'sources')) { const k = srcKey(b); out.sources[k] = (out.sources[k] ?? 0) + 1; }
    if (passes(b, f, now, 'staff')) { const k = b.assignedStaff?.id ?? '__un'; out.staff[k] = (out.staff[k] ?? 0) + 1; }
    if (passes(b, f, now, 'statuses')) { const k = listKey(b, now); out.statuses[k] = (out.statuses[k] ?? 0) + 1; }
    if (passes(b, f, now, 'preset')) for (const p of PRESETS) if (matchPreset(b, p, now)) out.presets[p] += 1;
  }
  return out;
}

export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// ── the day in numbers ─────────────────────────────────────────────────────

export interface DaySummary {
  /** Everything except cancelled. */
  appointments: number;
  /** Price of everything except cancelled and no-show. */
  expectedCents: number;
  /** Price of what is already completed. */
  doneCents: number;
  checkedIn: number;
  noShow: number;
  cancelled: number;
  attention: { late: number; pending: number; unassigned: number; total: number };
}

export function summarize(rows: DayBooking[], now = Date.now()): DaySummary {
  const s: DaySummary = { appointments: 0, expectedCents: 0, doneCents: 0, checkedIn: 0, noShow: 0, cancelled: 0, attention: { late: 0, pending: 0, unassigned: 0, total: 0 } };
  for (const b of rows) {
    if (b.status === 'CANCELLED') { s.cancelled += 1; continue; }
    s.appointments += 1;
    if (b.status === 'NO_SHOW') { s.noShow += 1; continue; }
    s.expectedCents += b.priceCents || 0;
    if (b.status === 'COMPLETED') s.doneCents += b.priceCents || 0;
    if (b.status === 'ARRIVED') s.checkedIn += 1;
    const a = attentionOf(b, now);
    if (a) { s.attention[a] += 1; s.attention.total += 1; }
  }
  return s;
}

/** Booked minutes of the bookings that still take time (not cancelled, not no-show). */
export function bookedMinutes(rows: DayBooking[]): number {
  return rows.filter((b) => !isGone(b.status)).reduce((m, b) => m + durationMin(b), 0);
}

// ── how full a day is ──────────────────────────────────────────────────────

export interface HoursDay { closed?: boolean; openMinutes?: number; closeMinutes?: number; intervals?: { open: number; close: number }[] | null }
export interface ShiftStaff {
  id: string;
  isActive?: boolean;
  takesAppointments?: boolean;
  workingHours?: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
}

export function hhmm(v: string): number {
  const [h, m] = String(v || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function openMinutesOf(day: HoursDay | null | undefined): number {
  if (!day || day.closed) return 0;
  const iv = (day.intervals ?? []).filter((x) => x && x.close > x.open);
  if (iv.length) return iv.reduce((m, x) => m + (x.close - x.open), 0);
  const o = Number(day.openMinutes), c = Number(day.closeMinutes);
  return Number.isFinite(o) && Number.isFinite(c) && c > o ? c - o : 0;
}

/** Minutes a tech works on a weekday (0 = Sunday); null when they have no hours set at all. */
export function shiftMinutes(s: ShiftStaff, dow: number): number | null {
  const all = s.workingHours ?? [];
  if (!all.length) return null;
  return all.filter((w) => w.isActive && w.dayOfWeek === dow).reduce((m, w) => m + Math.max(0, hhmm(w.endTime) - hhmm(w.startTime)), 0);
}

/**
 * Minutes of chair time the salon has on a date: each bookable tech's shift
 * (or the opening hours, for a tech with no hours set). A closed day or a day
 * off has none. No techs at all: one chair for the opening hours.
 */
export function capacityMinutes(args: { date: Date; staff: ShiftStaff[]; week?: (HoursDay | null | undefined)[] | null; daysOff?: string[] | null }): number {
  if (isClosedDay(args)) return 0;
  const dow = args.date.getDay();
  const open = openMinutesOf(args.week?.[dow]);
  const techs = args.staff.filter((s) => s.isActive !== false && s.takesAppointments !== false);
  if (!techs.length) return open;
  return techs.reduce((m, s) => { const sh = shiftMinutes(s, dow); return m + (sh === null ? open : sh); }, 0);
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Closed: a listed day off, or a weekday the salon set as closed. Unknown hours = open. */
export function isClosedDay(args: { date: Date; week?: (HoursDay | null | undefined)[] | null; daysOff?: string[] | null }): boolean {
  if ((args.daysOff ?? []).includes(dateKey(args.date))) return true;
  const day = args.week?.[args.date.getDay()];
  if (!args.week || !args.week.length || day === undefined || day === null) return false;
  return openMinutesOf(day) === 0;
}

/** 0..1, or null when the day has no capacity to compare against. */
export function loadOf(booked: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.max(0, Math.min(1, booked / capacity));
}

export type LoadLevel = 'light' | 'busy' | 'full';
export function loadLevel(p: number): LoadLevel {
  return p < 0.6 ? 'light' : p < 0.9 ? 'busy' : 'full';
}

/** `n` consecutive days starting on the Monday of `anchor`'s week. */
export function stripDays(anchor: Date, n: number): Date[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const back = (start.getDay() + 6) % 7; // Monday = 0
  start.setDate(start.getDate() - back);
  return Array.from({ length: n }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Days of a month as a Monday-first grid (leading nulls). */
export function monthGrid(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** "Next Monday" — never today, even on a Monday. */
export function nextMonday(d: Date): Date {
  const back = (d.getDay() + 6) % 7;
  return addDays(d, 7 - back);
}

/** A day's open stretches, in minutes after midnight. Empty = closed (or a day off). */
export function openIntervals(day: HoursDay | null | undefined): { open: number; close: number }[] {
  if (!day || day.closed) return [];
  const ivs = Array.isArray(day.intervals) ? day.intervals.filter((iv) => Number.isFinite(iv?.open) && Number.isFinite(iv?.close) && iv.close > iv.open) : [];
  if (ivs.length) return [...ivs].sort((a, b) => a.open - b.open);
  const o = Number(day.openMinutes); const c = Number(day.closeMinutes);
  return Number.isFinite(o) && Number.isFinite(c) && c > o ? [{ open: o, close: c }] : [];
}

/**
 * The time "Đặt lịch" opens the form on.
 *
 * Today: the next quarter hour — but never outside opening hours. Before the
 * salon opens it is the opening time; after it closes (or on a closed day /
 * day off) it is the next day the salon is open, at opening time. Another
 * day: that day's opening time, or the next open day when that one is closed.
 * With no hours recorded it falls back to the old rule (next quarter hour
 * today, 10:00 on other days), so nothing changes for a salon that never set
 * its hours.
 */
export function suggestStart(args: {
  date: Date; today: Date; nowMin: number;
  week?: (HoursDay | null | undefined)[] | null; daysOff?: string[] | null; maxAhead?: number;
}): { date: Date; minutes: number } {
  const isToday = args.date.getTime() === args.today.getTime();
  const nextQuarter = Math.min(23 * 60 + 45, Math.ceil((args.nowMin + 1) / 15) * 15);
  if (!args.week || !args.week.length) return { date: args.date, minutes: isToday ? nextQuarter : 600 };
  const off = new Set(args.daysOff ?? []);
  // A day in the past is still allowed to be looked at; start from today then.
  let d = args.date.getTime() < args.today.getTime() ? args.today : args.date;
  for (let i = 0; i <= (args.maxAhead ?? 14); i++, d = addDays(d, 1)) {
    if (off.has(dateKey(d))) continue;
    const ivs = openIntervals(args.week[d.getDay()]);
    if (!ivs.length) continue;
    if (d.getTime() !== args.today.getTime()) return { date: d, minutes: ivs[0].open };
    for (const iv of ivs) {
      if (nextQuarter < iv.open) return { date: d, minutes: iv.open };
      if (nextQuarter < iv.close) return { date: d, minutes: nextQuarter };
    }
  }
  return { date: args.date, minutes: isToday ? nextQuarter : 600 };
}

// ── Phone technician column: one booking card ──
// Text colour on a phone card (theme-aware), and how many lines a card of this
// height can hold: 1 (time · name · price), 2 (+ end time, status) or 3 (+ source, service).
export const cardInk = (status: string) => (status === 'COMPLETED' ? 'var(--ink-good)'
  : status === 'PENDING' || status === 'ASSIGNED' || status === 'REJECTED' ? 'var(--ink-warn)' : 'var(--ink-link)');
export const cardLines = (h: number): 1 | 2 | 3 => (h >= 76 ? 3 : h >= 46 ? 2 : 1);
export const statusTag = (status: string, vi: boolean): string => (status === 'COMPLETED' ? (vi ? 'Xong' : 'Done')
  : status === 'ARRIVED' ? (vi ? 'Đang làm' : 'In chair')
  : status === 'PENDING' || status === 'ASSIGNED' || status === 'REJECTED' ? (vi ? 'Chờ xác nhận' : 'Pending')
  : status === 'CONFIRMED' || status === 'ACCEPTED' ? (vi ? 'Đã đặt' : 'Booked') : '');
