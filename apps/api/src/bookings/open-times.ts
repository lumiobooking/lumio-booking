import { windowsForDay, type DayHoursLike } from '../settings/business-hours';
import { wallTimeToUtc } from './booking.util';

/**
 * The start times still open on one day — for the till, when a customer who
 * has just paid says "same again in two weeks?".
 *
 * The online booking page builds its own slot grid in the browser; this is the
 * server's version of the same arithmetic, for the one screen where the
 * receptionist needs a short list of real options rather than a calendar.
 *
 * Pure: hand it the day's windows, the tech's busy blocks and the clock, and it
 * answers. Nothing here reads the database — the spec pins each rule.
 */
export interface BusyBlock { start: Date; end: Date }

export function openTimesFor(args: {
  dateStr: string;              // YYYY-MM-DD, the salon's own calendar day
  tz: string;                   // the salon's IANA zone
  day: DayHoursLike | null;     // that weekday's opening hours
  closedToday?: boolean;        // a day off overrides the weekday hours
  stepMinutes: number;          // gap between offered starts
  durationMinutes: number;      // the visit must END before closing
  busy: BusyBlock[];            // the chosen tech's existing bookings + off-shift blocks
  now: Date;                    // nothing in the past is offered
}): Date[] {
  if (args.closedToday) return [];
  const step = Math.max(5, Math.min(120, Math.round(args.stepMinutes) || 15));
  const dur = Math.max(5, Math.round(args.durationMinutes) || 15);
  const out: Date[] = [];
  for (const w of windowsForDay(args.day)) {
    for (let m = w.open; m + dur <= w.close; m += step) {
      const start = wallTimeToUtc(args.dateStr, `${Math.floor(m / 60)}:${m % 60}`, args.tz);
      const end = new Date(start.getTime() + dur * 60_000);
      if (start.getTime() < args.now.getTime()) continue;
      const clash = args.busy.some((b) => start.getTime() < b.end.getTime() && b.start.getTime() < end.getTime());
      if (!clash) out.push(start);
    }
  }
  return out;
}
