/**
 * Which locale dates, times and numbers should be rendered in.
 *
 * Every screen used to hardcode 'en-US', which quietly assumes American date
 * order. `8/12/2026` reads as 8 December to a Vietnamese user and 12 August to
 * an American one, and nothing on screen says which is meant — an appointment
 * can sit four months out of place with everyone believing they read it right.
 *
 * The language the person picked in the header is the answer, and it already
 * lives in localStorage, so this can be read from plain helper functions as
 * well as components without threading a prop through every call site.
 *
 * On the server there is no localStorage and no person, so it answers 'en-US' —
 * exactly what the code did before — which also keeps server and client markup
 * identical during hydration.
 */
export function uiLocale(): string {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('lumio_lang') === 'vi'
      ? 'vi-VN'
      : 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * Which TIMEZONE dates and times belong to: the salon's, never the browser's.
 *
 * The owner of an Austin salon reads this dashboard from wherever they are —
 * a phone in Vietnam included — and every hour shown must still be Austin's.
 * SalonShell fetches the tenant's timezone once per session and leaves it in
 * localStorage; these helpers read it from there so a call site needs no prop.
 *
 * A missing value falls back to the browser's zone — the behaviour every
 * screen had before — so a salon with no timezone set changes nothing.
 */
export function salonTz(): string {
  try {
    return (typeof window !== 'undefined' && window.localStorage.getItem('lumio_tz')) || '';
  } catch {
    return '';
  }
}

/** formatToParts, read back as numbers. Shared plumbing for the helpers below. */
function tzParts(at: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const h = g('hour');
    const out = { y: g('year'), mo: g('month'), d: g('day'), h: h === 24 ? 0 : h, mi: g('minute') };
    return Object.values(out).every(Number.isFinite) ? out : null;
  } catch {
    return null;
  }
}

/**
 * A datetime-local value ("2026-09-02T20:59") read as SALON wall time, as the
 * UTC instant to store. DST-safe: the offset is derived for that very date.
 * Without a timezone it falls back to the browser's reading, as before.
 */
export function wallToInstantISO(local: string, tz: string = salonTz()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m || !tz) return new Date(local).toISOString();
  const [, y, mo, d, h, mi] = m.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const p = tzParts(new Date(naive), tz);
  if (!p) return new Date(local).toISOString();
  const asTz = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return new Date(naive - (asTz - naive)).toISOString();
}

/** A stored instant as a datetime-local value ("YYYY-MM-DDTHH:mm") in salon time. */
export function instantToWall(at: string | number | Date, tz: string = salonTz()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = tz ? tzParts(d, tz) : null;
  if (!p) return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** The salon-local calendar day of an instant, "YYYY-MM-DD". */
export function dayKeyInTz(at: string | number | Date, tz: string = salonTz()): string {
  const w = instantToWall(at, tz);
  return w.slice(0, 10);
}

/** The salon-local hour (0-23) of an instant. */
export function hourInTz(at: string | number | Date, tz: string = salonTz()): number {
  const d = new Date(at);
  const p = tz ? tzParts(d, tz) : null;
  return p ? p.h : d.getHours();
}

/**
 * toLocaleString in the person's LANGUAGE and the salon's TIMEZONE — the pair
 * almost every timestamp on the dashboard needs. An explicit timeZone in opts
 * wins; otherwise the salon's is filled in when known.
 */
export function fmtInTz(at: string | number | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const tz = salonTz();
  const merged = tz && !opts.timeZone ? { ...opts, timeZone: tz } : opts;
  try {
    return d.toLocaleString(uiLocale(), merged);
  } catch {
    return d.toLocaleString(uiLocale(), opts); // a bad stored tz must not blank the screen
  }
}

/** Tomorrow at a given salon wall time, as a datetime-local value ("YYYY-MM-DDTHH:mm"). */
export function wallTomorrowAt(hm = '10:00', tz: string = salonTz()): string {
  return `${dayKeyInTz(new Date(Date.now() + 86_400_000), tz)}T${hm}`;
}

/**
 * Report presets ("this month", "last 7 days"...) anchored to the SALON's
 * calendar. Built from wall digits only — never through toISOString, whose
 * detour into UTC used to hand "this month" the last day of the previous one.
 */
export function presetRangeInTz(
  kind: 'thisMonth' | 'lastMonth' | 'thisYear' | 'last7',
  tz: string = salonTz(),
): { from: string; to: string } {
  const today = dayKeyInTz(new Date(), tz);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (kind === 'thisMonth') return { from: `${y}-${pad(m)}-01`, to: today };
  if (kind === 'thisYear') return { from: `${y}-01-01`, to: today };
  if (kind === 'last7') return { from: dayKeyInTz(new Date(Date.now() - 6 * 86_400_000), tz), to: today };
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate(); // pure calendar math
  return { from: `${prevY}-${pad(prevM)}-01`, to: `${prevY}-${pad(prevM)}-${pad(lastDay)}` };
}
