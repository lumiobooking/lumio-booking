import { visitsAreTracked, MIN_PAST_BOOKINGS } from './visits-tracked';

/**
 * Nov 2026 audit: 14 salons took their bookings in Lumio and checked out on
 * another machine; their October report read "0 showed · $0 revenue ▼100%".
 * Those two numbers are "not measured" for such a salon, never 0.
 */
describe('does the salon close its visits in Lumio?', () => {
  it('bookings in the past, none checked in or paid, no walk-in → not tracked', () => {
    expect(visitsAreTracked({ pastBookings: 70, showed: 0, revenueCents: 0, walkIns: 0 })).toBe(false);
  });
  it('one check-in, one payment or one walk-in is enough to trust the numbers', () => {
    expect(visitsAreTracked({ pastBookings: 70, showed: 1, revenueCents: 0, walkIns: 0 })).toBe(true);
    expect(visitsAreTracked({ pastBookings: 70, showed: 0, revenueCents: 500, walkIns: 0 })).toBe(true);
    expect(visitsAreTracked({ pastBookings: 70, showed: 0, revenueCents: 0, walkIns: 2 })).toBe(true);
  });
  it('a couple of real no-shows is not evidence of checking out elsewhere', () => {
    expect(visitsAreTracked({ pastBookings: MIN_PAST_BOOKINGS - 1, showed: 0, revenueCents: 0, walkIns: 0 })).toBe(true);
    expect(visitsAreTracked({ pastBookings: 0, showed: 0, revenueCents: 0, walkIns: 0 })).toBe(true);
  });
});
