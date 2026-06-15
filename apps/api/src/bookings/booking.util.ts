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
