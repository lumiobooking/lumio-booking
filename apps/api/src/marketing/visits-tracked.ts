/**
 * DOES THIS SALON CLOSE ITS VISITS IN LUMIO?
 *
 * "Đã đến" (showed) and "Doanh thu" (revenue) in the monthly report come from
 * visits checked in / checked out in Lumio and payments recorded against them.
 * Many salons take their bookings through Lumio and check out on another
 * machine: every past booking is then swept to NO_SHOW at midnight and the
 * report printed "0 showed · $0 revenue · ▼100%" for a salon that was busy
 * all month (Nov 2026 audit: 14 of 34 booking salons).
 *
 * Not tracked = it had past bookings, and not one visit was checked in or
 * paid, and no walk-in ticket was opened. Those two numbers are then
 * "not measured", never 0. A salon with a couple of bookings that really were
 * missed is still counted (below MIN_PAST the evidence is too thin to say
 * the salon closes visits elsewhere). Pure.
 */
export const MIN_PAST_BOOKINGS = 3;

export function visitsAreTracked(x: { pastBookings: number; showed: number; revenueCents: number; walkIns: number }): boolean {
  if (x.pastBookings < MIN_PAST_BOOKINGS) return true;
  return x.showed > 0 || x.revenueCents > 0 || x.walkIns > 0;
}
