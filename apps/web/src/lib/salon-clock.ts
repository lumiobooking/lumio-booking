/**
 * What day and time it is AT THE SALON — never at the visitor's phone.
 *
 * WHY THIS EXISTS
 *
 * The "Next opening today at 2:00 PM" banner on a booking page was computed
 * from `new Date()` in the visitor's browser. Two people opening the same
 * salon's page from different time zones were told different opening times for
 * the same shop, and neither matched what the owner had typed into Business
 * hours.
 *
 * There are two separate leaks, and fixing only the obvious one leaves the
 * worse one in place:
 *
 *  1. WHICH TIME. generateSlots() already accepts the salon's timezone and uses
 *     it to decide whether a slot is "already past". The date picker passed it;
 *     the banner, eight lines away, did not. So the banner filtered the salon's
 *     morning against the VISITOR's clock and reported the first slot that
 *     survived — a time that slides with the reader's offset.
 *
 *  2. WHICH DAY. `new Date()` is also the visitor's calendar date. Someone in
 *     Vietnam reading a California salon's page in their morning is a day ahead
 *     of it. The banner then reads the WRONG ROW of business hours: it can
 *     announce Sunday's hours on a Saturday, or say "closed" about a day the
 *     salon is open. This one is silent and much harder to spot, because the
 *     number it prints is a real opening time — just not today's.
 *
 * A salon's hours are stored as minutes from midnight in the salon's own local
 * time. Any code that turns those minutes into an instant, or asks "what day is
 * it", must say whose midnight it means.
 */

/**
 * The salon's current calendar date, returned as a Date at LOCAL midnight
 * carrying that date's year/month/day.
 *
 * Local midnight, deliberately: the rest of the booking page builds slots with
 * `new Date(y, m, d, hh, mm)` — wall-clock digits in the browser's zone — and
 * formats them back with toLocaleTimeString, so the digits round-trip. Changing
 * that convention here would shift every slot on the page. All this function
 * fixes is WHICH y/m/d those digits belong to.
 *
 * A missing timezone falls back to the visitor's date, which is exactly what
 * the page does today — so a salon with no timezone set behaves as it always
 * has rather than breaking.
 */
export function todayInZone(timeZone: string | null | undefined, now: Date = new Date()): Date {
  const tz = String(timeZone ?? '').trim();
  if (!tz) {
    const d = new Date(now.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) throw new Error('unreadable');
    return new Date(y, m - 1, d);
  } catch {
    // An invalid timezone string must not blank the page. Fall back to the
    // visitor's date — wrong for distant readers, but the same wrong the page
    // has always had, rather than a crash.
    const d = new Date(now.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * The weekday index (0 = Sunday) at the salon, for indexing businessHours.
 *
 * Reading this off the visitor's clock is how a Saturday visitor gets shown
 * Sunday's hours — and "Sunday: closed" reads as "this salon is shut", which
 * costs a booking without anyone finding out.
 */
export function weekdayInZone(timeZone: string | null | undefined, now: Date = new Date()): number {
  return todayInZone(timeZone, now).getDay();
}

/**
 * Is the salon's calendar date the same as the visitor's?
 *
 * Only used to decide whether the word "today" is honest. Saying "today" to
 * someone for whom it is already tomorrow is a small lie that makes every other
 * number on the badge suspect.
 */
export function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
