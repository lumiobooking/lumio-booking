/**
 * Whether a salon is open at a given moment — decided on the SERVER.
 *
 * WHY THIS EXISTS
 *
 * The slot grid a customer picks from is generated in the browser, from the
 * salon's business hours. That is a good way to build a UI and a useless way to
 * enforce a rule: the booking endpoint had no business-hours check at all, so a
 * request posted directly — by a script, a stale tab, a bot, or a customer who
 * kept a page open past a settings change — would be accepted for 3am on a day
 * the salon is shut. The salon finds out when someone turns up.
 *
 * A rule that only exists in the interface is a suggestion.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It is applied to PUBLIC bookings only. Staff creating a booking from the
 * dashboard must still be able to write down a walk-in at 8pm, a favour for a
 * regular, or a job that ran long. The rule protects the salon from the outside;
 * it does not tell the owner what they may do inside their own shop.
 */

export interface DayWindow {
  open: number;
  close: number;
}

export interface DayHoursLike {
  closed?: boolean;
  openMinutes?: number;
  closeMinutes?: number;
  intervals?: DayWindow[] | null;
}

/**
 * The open windows for one weekday, in minutes from midnight.
 *
 * `intervals` wins when present — that is the split-shift case (lunch, then
 * dinner). Otherwise the single span. Returns [] when the day is closed, so a
 * caller can treat "closed" and "no window matches" the same way.
 */
export function windowsForDay(day: DayHoursLike | null | undefined): DayWindow[] {
  if (!day || day.closed) return [];
  const ivs = Array.isArray(day.intervals) ? day.intervals : [];
  const clean = ivs
    .map((iv) => ({ open: Math.round(Number(iv?.open)), close: Math.round(Number(iv?.close)) }))
    .filter((iv) => Number.isFinite(iv.open) && Number.isFinite(iv.close) && iv.close > iv.open);
  if (clean.length) return clean.sort((a, b) => a.open - b.open);

  const open = Math.round(Number(day.openMinutes));
  const close = Math.round(Number(day.closeMinutes));
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  return [{ open, close }];
}

/**
 * Does an appointment of `durationMin` starting at `startMinutes` fit inside
 * the salon's opening hours for that weekday?
 *
 * The WHOLE appointment must fit. A 60-minute service starting 30 minutes
 * before closing is not a booking, it is a customer left sitting in a dark
 * salon — and it is exactly what an unchecked endpoint would accept.
 */
export function fitsBusinessHours(args: {
  day: DayHoursLike | null | undefined;
  startMinutes: number;
  durationMin: number;
}): boolean {
  const windows = windowsForDay(args.day);
  if (!windows.length) return false;

  const start = Math.round(Number(args.startMinutes));
  // A zero or negative duration would "fit" anywhere, so it is treated as an
  // instant at the start time rather than allowed to wave the check through.
  const dur = Math.max(0, Math.round(Number(args.durationMin)) || 0);
  if (!Number.isFinite(start) || start < 0) return false;

  return windows.some((w) => start >= w.open && start + dur <= w.close);
}

/**
 * Hours that are legal but almost certainly a mistake.
 *
 * A US salon's Sunday was saved as 00:00–17:00 and the booking page dutifully
 * offered 12:00 AM, 12:30 AM, 1:00 AM. Nothing was broken: the owner had picked
 * 12 AM in a 12-hour time picker meaning noon, and every layer believed them.
 *
 * There is no way to tell a typo from a genuine all-night salon by looking at
 * the number, so this returns a WARNING for a human to confirm rather than an
 * error. Refusing outright would be wrong for the rare salon that really does
 * open at 5am.
 */
export function suspiciousHours(day: DayHoursLike | null | undefined): string | null {
  const windows = windowsForDay(day);
  if (!windows.length) return null;

  const open = Math.min(...windows.map((w) => w.open));
  const close = Math.max(...windows.map((w) => w.close));

  // Before 5am. Midnight to 4:59 is where the 12 AM / 12 PM mix-up lands, and a
  // nail salon opening then is vanishingly rare.
  if (open < 5 * 60) return 'opens-too-early';
  // Sixteen hours is longer than any single-shift salon works, and it is what
  // you get when one end of the pair is out by twelve.
  if (close - open >= 16 * 60) return 'span-too-long';
  return null;
}

/** Minutes from midnight → "1:30 PM", for messages a salon owner reads. */
export function minutesToClock(mins: number): string {
  const m = ((Math.round(Number(mins)) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${suffix}`;
}

/** "9:30 AM–7:00 PM" or "9:30 AM–12:00 PM, 1:00 PM–7:00 PM" for split shifts. */
export function describeWindows(day: DayHoursLike | null | undefined): string {
  const windows = windowsForDay(day);
  if (!windows.length) return 'closed';
  return windows.map((w) => `${minutesToClock(w.open)}–${minutesToClock(w.close)}`).join(', ');
}
