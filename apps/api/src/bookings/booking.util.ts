import { AppointmentStatus } from '@prisma/client';

/**
 * Appointment statuses that occupy a staff member's time and therefore conflict
 * with a new booking in the same slot. CANCELLED / REJECTED / COMPLETED /
 * NO_SHOW do not block a slot.
 */
export const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.ASSIGNED,
  AppointmentStatus.ACCEPTED,
  AppointmentStatus.CONFIRMED,
];

/** Adds whole minutes to a date and returns a new Date. */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd. Back-to-back bookings (one ends exactly when
 * the next starts) do NOT overlap.
 */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Parses an ISO date-time string; throws a typed error on invalid input. */
export function parseStartTime(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid startTime');
  }
  return d;
}
/** Detect whether an online booking came from a phone or a computer, via User-Agent. */
export function deviceSource(ua?: string | null): 'mobile' | 'web' {
  return ua && /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua) ? 'mobile' : 'web';
}

/**
 * A wall-clock time in a given IANA timezone as a UTC instant.
 * "2026-07-30" + "16:00" in America/Chicago -> 2026-07-30T21:00:00Z.
 * DST-safe: the offset is derived for that specific date, not assumed.
 */
export function wallTimeToUtc(dateStr: string, hm: string, tz: string): Date {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  const guess = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00Z`);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess);
    const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour') % 24, num('minute'), num('second'));
    return new Date(guess.getTime() - (asUtc - guess.getTime()));
  } catch {
    return guess; // unknown timezone -> treat the wall clock as UTC
  }
}
