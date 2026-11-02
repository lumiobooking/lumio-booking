/**
 * MỞ LỊCH / KHOÁ GIỜ BẰNG CÁCH KÉO — the time arithmetic, pure.
 *
 * On the Calendar the desk drags over a technician's column:
 *  - over time she works → "khoá giờ": a block (an approved time-off row made
 *    by the desk, exactly what the Block-time sheet makes);
 *  - over time she is off (outside her weekly hours, a day off, or a block
 *    the desk made) → "mở lịch lại": the block is cut back and the hours
 *    outside her schedule become EXTRA HOURS for that day (staff_extra_hours).
 *
 * Extra hours are read wherever "is she working then?" is decided, through
 * withExtraHours(): it adds the day's extra windows to her weekly rows, so the
 * desk, the booking page, the chat bot, the hotline and the assignment engine
 * all agree. A technician with no weekly hours at all follows the salon's
 * hours and is never narrowed by this.
 */

export interface Span { s: number; e: number }
export interface ExtraRow { staffId: string; day: string; startTime: string; endTime: string }
export interface WeeklyRow { dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }

export const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};
export const toHm = (min: number): string => {
  const v = Math.max(0, Math.min(24 * 60, Math.round(min)));
  if (v >= 24 * 60) return '23:59';
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
export const dowOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Overlapping or touching spans as one. */
export function union(spans: Span[]): Span[] {
  const xs = spans.filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s).sort((a, b) => a.s - b.s);
  const out: Span[] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ ...x });
  }
  return out;
}

/** What is left of `a` once `cut` is taken out. */
export function subtract(a: Span[], cut: Span[]): Span[] {
  let left = union(a);
  for (const c of union(cut)) {
    const next: Span[] = [];
    for (const x of left) {
      if (c.e <= x.s || c.s >= x.e) { next.push(x); continue; }
      if (c.s > x.s) next.push({ s: x.s, e: c.s });
      if (c.e < x.e) next.push({ s: c.e, e: x.e });
    }
    left = next;
  }
  return left;
}

/** The parts of `a` that are also in `b`. */
export function intersect(a: Span[], b: Span[]): Span[] {
  return subtract(union(a), subtract(union(a), b));
}

/**
 * Her weekly rows with the day's extra windows added, as weekly rows for that
 * weekday (merged with the regular ones, so a booking running from her normal
 * hours into the extra ones fits in one window). Only that date's extras are
 * added — callers decide one date at a time.
 */
export function withExtraHours<T extends WeeklyRow>(hours: T[], extras: ExtraRow[], staffId: string, day: string): WeeklyRow[] {
  const active = (hours ?? []).filter((h) => h.isActive !== false);
  if (!active.length) return hours ?? [];
  const mine = (extras ?? []).filter((x) => x.staffId === staffId && x.day === day);
  if (!mine.length) return hours;
  const dow = dowOf(day);
  const merged = union([
    ...active.filter((h) => h.dayOfWeek === dow).map((h) => ({ s: toMin(h.startTime), e: toMin(h.endTime) })),
    ...mine.map((x) => ({ s: toMin(x.startTime), e: toMin(x.endTime) })),
  ]);
  return [
    ...hours.filter((h) => h.dayOfWeek !== dow),
    ...merged.map((x) => ({ dayOfWeek: dow, startTime: toHm(x.s), endTime: toHm(x.e), isActive: true })),
  ];
}

/** Her working spans on that day: weekly rows (+ extras). Null = no weekly hours on file (she follows the salon). */
export function shiftSpans(hours: WeeklyRow[], extras: ExtraRow[], staffId: string, day: string): Span[] | null {
  const active = (hours ?? []).filter((h) => h.isActive !== false);
  if (!active.length) return null;
  const dow = dowOf(day);
  return union(withExtraHours(active, extras, staffId, day)
    .filter((h) => h.dayOfWeek === dow)
    .map((h) => ({ s: toMin(h.startTime), e: toMin(h.endTime) })));
}

/** Every extra window for these days (and technicians). Never throws: a salon without the table yet reads none. */
export async function loadExtraHours(db: unknown, tenantId: string, from: string, to: string, staffIds?: string[]): Promise<ExtraRow[]> {
  if (!tenantId) return [];
  try {
    return await (db as any).staffExtraHours.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
      where: { tenantId, day: { gte: from, lte: to }, ...(staffIds ? { staffId: { in: staffIds } } : {}) },
      select: { staffId: true, day: true, startTime: true, endTime: true },
      take: 2000,
    }) ?? [];
  } catch { return []; }
}

// ---- cutting a block back -----------------------------------------------------

export interface BlockLike { startDate: string; endDate: string; startTime?: string | null; endTime?: string | null }

const addDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * What remains of a block once [s, e) of one day is opened again: the days
 * before, the days after (both whole, as before), and the rest of that day as
 * part-day pieces. An empty list = the block is gone.
 */
export function cutBlock(b: BlockLike, day: string, s: number, e: number): BlockLike[] {
  if (day < b.startDate || day > b.endDate) return [b];
  const out: BlockLike[] = [];
  const partDay = !!(b.startTime && b.endTime);
  if (b.startDate < day) out.push({ startDate: b.startDate, endDate: addDay(day, -1), startTime: b.startTime ?? null, endTime: b.endTime ?? null });
  const onDay: Span[] = partDay ? [{ s: toMin(b.startTime!), e: toMin(b.endTime!) }] : [{ s: 0, e: 24 * 60 }];
  for (const x of subtract(onDay, [{ s, e }])) {
    out.push({ startDate: day, endDate: day, startTime: toHm(x.s), endTime: x.e >= 24 * 60 ? '23:59' : toHm(x.e) });
  }
  if (b.endDate > day) out.push({ startDate: addDay(day, 1), endDate: b.endDate, startTime: b.startTime ?? null, endTime: b.endTime ?? null });
  return out;
}

/** The part of one day a block covers, or null when it does not touch that day. */
export function blockSpanOn(b: BlockLike, day: string): Span | null {
  if (day < b.startDate || day > b.endDate) return null;
  if (b.startTime && b.endTime) return { s: toMin(b.startTime), e: toMin(b.endTime) };
  return { s: 0, e: 24 * 60 };
}
