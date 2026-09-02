/**
 * The salon's clock, for services that report and bucket by day.
 *
 * Every tenant-facing notion of "today", "this month", an hour-of-day or a
 * weekday must be computed in the TENANT's timezone. The server's own clock is
 * an accident of where the box runs; a report bucketed by it moves an Austin
 * salon's Friday-evening rush onto Saturday morning the moment the server (or
 * the person reading) sits in another timezone.
 *
 * Everything here is pure and Intl-based, so it is DST-safe and testable with
 * fixtures. A timezone that Intl rejects falls back to UTC — wrong for distant
 * salons, but stable, and never a crash in a report path.
 */

interface Parts { y: number; m: number; d: number; h: number; mi: number; wd: number }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of an instant in a timezone. */
export function tzPartsOf(at: Date, tz: string): Parts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const h = g('hour');
    const out = { y: g('year'), m: g('month'), d: g('day'), h: h === 24 ? 0 : h, mi: g('minute'), wd: WD[parts.find((p) => p.type === 'weekday')?.value ?? ''] ?? 0 };
    if ([out.y, out.m, out.d, out.h, out.mi].every(Number.isFinite)) return out;
  } catch { /* fall through to UTC */ }
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate(), h: at.getUTCHours(), mi: at.getUTCMinutes(), wd: at.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The salon-local calendar day of an instant, "YYYY-MM-DD". */
export function dayKeyTz(at: Date, tz: string): string {
  const p = tzPartsOf(at, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The salon-local month of an instant, "YYYY-MM". */
export function monthKeyTz(at: Date, tz: string): string {
  return dayKeyTz(at, tz).slice(0, 7);
}

/** The salon-local hour (0-23) of an instant. */
export function hourTz(at: Date, tz: string): number {
  return tzPartsOf(at, tz).h;
}

/** The salon-local weekday (0 = Sunday) of an instant. */
export function weekdayTz(at: Date, tz: string): number {
  return tzPartsOf(at, tz).wd;
}

/**
 * A wall-clock time in the salon's timezone as the UTC instant.
 * "2026-07-30" + "16:00" in America/Chicago -> 2026-07-30T21:00:00Z.
 * DST-safe: the offset is derived for that very date. Same algorithm as
 * bookings/booking.util.ts, kept here so report code need not import bookings.
 */
export function wallTimeToUtcTz(dateStr: string, hm: string, tz: string): Date {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  const guess = new Date(`${dateStr}T${pad(h || 0)}:${pad(m || 0)}:00Z`);
  try {
    const p = tzPartsOf(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    return new Date(guess.getTime() - (asUtc - guess.getTime()));
  } catch {
    return guess;
  }
}

/** Salon-local midnight that begins the given day, as an instant. */
export function startOfDayTz(dayStr: string, tz: string): Date {
  return wallTimeToUtcTz(dayStr, '00:00', tz);
}

/** Calendar arithmetic on a day key — no timezone can shift a pure date. */
export function addDaysToKey(dayStr: string, days: number): string {
  const [y, m, d] = dayStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * A [from, to] query window over salon-local days, ends inclusive.
 * Missing edges default to the trailing `defaultDays` ending today (salon's
 * today). The `to` instant is the last millisecond of that salon day.
 */
export function dayRangeTz(
  fromStr: string | null | undefined,
  toStr: string | null | undefined,
  tz: string,
  opts: { now?: Date; defaultDays?: number } = {},
): { from: Date; to: Date; fromKey: string; toKey: string } {
  const now = opts.now ?? new Date();
  const todayKey = dayKeyTz(now, tz);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(toStr ?? '')) ? String(toStr) : todayKey;
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(fromStr ?? ''))
    ? String(fromStr)
    : addDaysToKey(toKey, -((opts.defaultDays ?? 30) - 1));
  return {
    from: startOfDayTz(fromKey, tz),
    to: new Date(startOfDayTz(addDaysToKey(toKey, 1), tz).getTime() - 1),
    fromKey,
    toKey,
  };
}

/** The salon-local month containing `at`, ends exclusive, as instants. */
export function monthRangeTz(at: Date, tz: string, shiftMonths = 0): { from: Date; to: Date; key: string } {
  const p = tzPartsOf(at, tz);
  const total = p.y * 12 + (p.m - 1) + shiftMonths;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const nextTotal = total + 1;
  const ny = Math.floor(nextTotal / 12);
  const nm = (nextTotal % 12) + 1;
  return {
    from: startOfDayTz(`${y}-${pad(m)}-01`, tz),
    to: startOfDayTz(`${ny}-${pad(nm)}-01`, tz),
    key: `${y}-${pad(m)}`,
  };
}
