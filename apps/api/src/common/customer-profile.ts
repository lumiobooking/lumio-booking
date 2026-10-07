/**
 * A CUSTOMER'S HABITS — phase 3 of "the bot learns over time".
 *
 * Every finished visit already says what the customer had, with whom and
 * when. Read together they are a profile: the services she keeps coming back
 * for, the technician she sees, the day and time of day she likes. The bot
 * can then offer "Same as last time — gel manicure with Ivy, Saturday
 * morning?" instead of starting from zero, and the desk sees the same on the
 * customer page.
 *
 * Computed from the visits each time (never stored), so it is always as
 * fresh as the calendar and there is nothing to keep in sync. Pure.
 */

export interface Visit { at: Date; services: string[]; staff: string | null; priceCents?: number | null }

export type DayPart = 'morning' | 'afternoon' | 'evening';

export interface CustomerProfile {
  visits: number;
  /** Most-booked services, most first (at most 3). */
  favourites: { name: string; count: number }[];
  /** The technician she sees most — only when it is a real habit (≥2 visits and at least half of them). */
  preferredStaff: { name: string; count: number } | null;
  /** 0 = Sunday … 6 = Saturday, in the salon's timezone; only when a habit. */
  usualWeekday: number | null;
  usualPart: DayPart | null;
  avgSpendCents: number | null;
  lastServices: string[];
  lastStaff: string | null;
}

function tzParts(d: Date, tz: string | null | undefined): { wd: number; h: number } {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(d);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find((x) => x.type === 'weekday')?.value ?? '');
    return { wd, h: Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24 };
  } catch {
    return { wd: d.getUTCDay(), h: d.getUTCHours() };
  }
}

const partOf = (h: number): DayPart => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');

/** The value seen most often, when it is a habit: at least `min` times and at least half the time. */
function habit<T>(values: T[], min = 2): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best && best.count >= min && best.count * 2 >= values.length ? best : null;
}

export function profileFrom(visitsIn: Visit[], tz?: string | null): CustomerProfile {
  const visits = [...visitsIn].filter((v) => v.at instanceof Date && !Number.isNaN(v.at.getTime())).sort((a, b) => b.at.getTime() - a.at.getTime());
  const svc = new Map<string, number>();
  for (const v of visits) for (const s of new Set(v.services.map((x) => x.trim()).filter(Boolean))) svc.set(s, (svc.get(s) ?? 0) + 1);
  const favourites = [...svc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, count]) => ({ name, count }));
  const staff = habit(visits.map((v) => v.staff).filter((x): x is string => !!x));
  const parts = visits.map((v) => tzParts(v.at, tz));
  const wd = habit(parts.map((p) => p.wd).filter((x) => x >= 0));
  const pt = habit(parts.map((p) => partOf(p.h)));
  const priced = visits.map((v) => v.priceCents).filter((x): x is number => typeof x === 'number' && x > 0);
  return {
    visits: visits.length,
    favourites,
    preferredStaff: staff ? { name: staff.value, count: staff.count } : null,
    usualWeekday: wd ? wd.value : null,
    usualPart: pt ? pt.value : null,
    avgSpendCents: priced.length ? Math.round(priced.reduce((a, b) => a + b, 0) / priced.length) : null,
    lastServices: visits[0]?.services ?? [],
    lastStaff: visits[0]?.staff ?? null,
  };
}

const VI_DAY = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
const EN_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VI_PART: Record<DayPart, string> = { morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối' };

/** "Gel manicure + Pedicure · thợ Ivy · thứ Bảy buổi sáng" — one line for the bot and the desk. */
export function habitLine(p: CustomerProfile | null | undefined, en: boolean): string {
  if (!p || p.visits < 2) return '';
  const bits: string[] = [];
  const fav = p.favourites.filter((f) => f.count >= 2).map((f) => f.name);
  if (fav.length) bits.push(fav.join(' + '));
  if (p.preferredStaff) bits.push(en ? `with ${p.preferredStaff.name}` : `thợ ${p.preferredStaff.name}`);
  const when = [p.usualWeekday != null ? (en ? EN_DAY[p.usualWeekday] : VI_DAY[p.usualWeekday]) : '', p.usualPart ? (en ? `${p.usualPart}s` : VI_PART[p.usualPart]) : ''].filter(Boolean).join(' ');
  if (when) bits.push(when);
  return bits.join(' · ');
}
