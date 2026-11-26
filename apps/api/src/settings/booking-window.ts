/**
 * rt240 — a booking window that leaves no bookable time (26/11/2026).
 *
 * Nailstop & Beauty had "book at most 1 day ahead" and "at least 90 hours
 * before" (90 was meant as minutes). The earliest time (now + 90 h) was after
 * the latest day (tomorrow), so the online page offered no time on any day.
 * The save is now refused with words that say why, and the screen warns as
 * the numbers are typed.
 *
 * Pure.
 */
export function windowProblem(minLeadHours: unknown, maxAdvanceDays: unknown): string | null {
  const lead = Number(minLeadHours);
  const days = Number(maxAdvanceDays);
  if (!Number.isFinite(lead) || !Number.isFinite(days)) return null;
  if (days < 1) return 'The booking window must be at least 1 day.';
  // The window ends at the close of the last day: from now that is between (days) and (days + 1) × 24 h.
  if (lead >= days * 24) {
    return `With "at least ${lead} hours before" and "at most ${days} day${days === 1 ? '' : 's'} ahead", no time can ever be booked online. Lower the hours (e.g. 1–2) or raise the days.`;
  }
  return null;
}
