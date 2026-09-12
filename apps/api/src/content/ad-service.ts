import { bi, type Txt } from './i18n';

/**
 * WHICH SERVICE THE AD IS ALLOWED TO SELL.
 *
 * THE BUG THIS MODULE EXISTS TO KILL
 *
 * The plan used to hand the ad whatever earned most per chair-hour, straight
 * off `serviceYields`. On a real salon's menu that is a five-minute chin wax:
 * $8 for 5 minutes is $96 an hour, and a $60 full set that takes an hour is
 * $60. So the card on a paying customer's screen said, in bold, to advertise
 * "Chin". Three separate things are wrong with that, and an owner spots all
 * three faster than we did:
 *
 *   1. Nobody drives across town for a chin wax. It is bought while already in
 *      the chair. An ad for it has no destination intent behind it.
 *   2. The money does not work. The campaign's spending limit per new customer
 *      is priced off the average ticket. Paying up to $22 to win a customer who
 *      buys an $8 service loses money on every single click, by arithmetic.
 *   3. The per-chair-hour figure is a phantom. To turn $96/hour into real money
 *      you need twelve chin waxes back to back, which never happens. Yield per
 *      hour only means something for a service long enough to hold the chair.
 *
 * Per-chair-hour is still the right way to RANK things worth advertising — it
 * is why a $45/40min service beats a $60/90min one. It is the wrong way to
 * DECIDE what is worth advertising at all. So the ranking stays and three gates
 * go in front of it.
 *
 * EVERY GATE IS ONE SENTENCE THE OWNER CAN CHECK
 *
 * Nothing here is a rule of thumb from the trade. The duration floor, the money
 * floor and the demand test are each a fact out of this salon's own menu and
 * its own last thirty days, which is what lets the card show its work instead
 * of asserting a conclusion.
 */

/** A menu row, with how often it was actually booked lately. */
export interface AdMenuItem {
  name: string;
  priceCents: number;
  durationMinutes: number;
  /** Appointments for it in the recent window. 0 or absent = none seen. */
  bookings?: number;
}

export interface AdServiceRow {
  name: string;
  priceCents: number;
  minutes: number;
  perHourCents: number;
  bookings: number;
}

/**
 * How the pick was made — the card says which of these it is, because
 * "chosen from your bookings" and "chosen from your price list" are not the
 * same promise and must not read the same.
 */
export type AdServiceBasis =
  /** Booked by real customers AND worth at least an average ticket. */
  | 'booked-and-pays'
  /** Worth an average ticket, but no bookings recorded for it lately. */
  | 'pays-not-booked'
  /** Nothing on the menu reaches an average ticket; best long service used. */
  | 'best-available'
  /** No usable menu — no price, or no duration. */
  | 'none';

export interface AdServicePick {
  names: string[];
  rows: AdServiceRow[];
  basis: AdServiceBasis;
  /** Ruled out on purpose, and why. Shown to the owner; it is the work. */
  skipped: { name: string; why: 'add-on' | 'under-ticket' }[];
  /** The money floor actually applied, when there was a ticket to apply. */
  floorCents: number | null;
}

/**
 * Under this, a service is an add-on, not a destination.
 *
 * Half an hour is the line at which a visit is worth making on its own — and,
 * separately, the line below which "per chair-hour" stops describing anything
 * achievable. A 30-minute service can genuinely run twice in an hour; a
 * 5-minute one cannot run twelve times.
 */
export const MIN_AD_MINUTES = 30;

/** Two names in one ad. Three is a menu, and a menu is not an ad. */
export const AD_PICK_LIMIT = 2;

const rowOf = (m: AdMenuItem): AdServiceRow => ({
  name: m.name.trim(),
  priceCents: Math.round(m.priceCents),
  minutes: Math.round(m.durationMinutes),
  perHourCents: Math.round((m.priceCents / m.durationMinutes) * 60),
  bookings: Math.max(0, Math.round(Number(m.bookings ?? 0))),
});

/**
 * Booked first, then per chair-hour.
 *
 * Demand evidence outranks a marginal yield difference: a service eleven people
 * asked for this month is a safer thing to put money behind than one nobody has
 * asked for that earns three dollars more an hour on paper.
 */
const byDemandThenYield = (a: AdServiceRow, b: AdServiceRow) => {
  const ab = a.bookings > 0 ? 1 : 0;
  const bb = b.bookings > 0 ? 1 : 0;
  if (ab !== bb) return bb - ab;
  if (b.perHourCents !== a.perHourCents) return b.perHourCents - a.perHourCents;
  return b.priceCents - a.priceCents;
};

/**
 * What the ad sells, and what it deliberately does not.
 *
 * `avgTicketCents` is the same ticket the budget and the cost-per-customer
 * ceiling are built on, which is the whole point of using it as the floor: one
 * number governs what we are willing to pay for a customer and what we are
 * willing to sell them, so the two halves of the plan cannot contradict.
 */
export function pickAdServices(
  menu: AdMenuItem[] | null | undefined,
  avgTicketCents: number | null | undefined,
  limit = AD_PICK_LIMIT,
): AdServicePick {
  const usable = (menu ?? [])
    .filter((m) => m && String(m.name ?? '').trim()
      && Number(m.priceCents) > 0 && Number(m.durationMinutes) > 0)
    .map(rowOf);

  const floor = avgTicketCents && avgTicketCents > 0 ? Math.round(avgTicketCents) : null;
  const empty: AdServicePick = { names: [], rows: [], basis: 'none', skipped: [], floorCents: floor };
  if (!usable.length) return empty;

  const longEnough = usable.filter((r) => r.minutes >= MIN_AD_MINUTES);
  const tooShort = usable.filter((r) => r.minutes < MIN_AD_MINUTES);

  // The add-ons that the old ranking would have led with: short, and top of the
  // per-chair-hour table precisely because they are short. Naming them is what
  // shows the owner the trap was seen and avoided.
  const addOns = [...tooShort]
    .sort((a, b) => b.perHourCents - a.perHourCents)
    .slice(0, 2)
    .map((r) => ({ name: r.name, why: 'add-on' as const }));

  if (!longEnough.length) return { ...empty, skipped: addOns };

  const pays = floor ? longEnough.filter((r) => r.priceCents >= floor) : longEnough;
  const tier = pays.length ? pays : longEnough;
  const rows = [...tier].sort(byDemandThenYield).slice(0, Math.max(1, limit));

  const basis: AdServiceBasis = !pays.length
    ? 'best-available'
    : rows.some((r) => r.bookings > 0)
      ? 'booked-and-pays'
      : 'pays-not-booked';

  // Under-ticket names are only worth listing when the floor is what removed
  // them; in 'best-available' the floor removed everything and saying so once
  // in prose is clearer than a list.
  const underTicket = basis === 'best-available' || !floor
    ? []
    : longEnough
      .filter((r) => r.priceCents < floor)
      .sort((a, b) => b.perHourCents - a.perHourCents)
      .slice(0, 1)
      .map((r) => ({ name: r.name, why: 'under-ticket' as const }));

  return {
    names: rows.map((r) => r.name),
    rows,
    basis,
    // Both kinds survive the cap on purpose: capping the combined list was
    // enough to drop the under-ticket row behind two add-ons, and the card then
    // explained only half of what it had ruled out.
    skipped: [...addOns, ...underTicket],
    floorCents: floor,
  };
}

/** The pick, for the TEAM's log — never for the salon. */
export function pickBasisNote(p: AdServicePick): Txt {
  switch (p.basis) {
    case 'booked-and-pays':
      return bi('chọn từ dịch vụ có lượt đặt thật và đạt mức hoá đơn trung bình',
        'picked from services with real bookings that clear the average ticket');
    case 'pays-not-booked':
      return bi('đạt mức hoá đơn trung bình nhưng chưa có lượt đặt ghi nhận',
        'clears the average ticket but has no bookings on record');
    case 'best-available':
      return bi('không có dịch vụ nào đạt mức hoá đơn trung bình — lấy dịch vụ dài và giá cao nhất',
        'no service reaches the average ticket — longest, highest-priced used');
    default:
      return bi('bảng giá chưa có giá hoặc thời lượng để chọn',
        'the price list has no price or no duration to choose from');
  }
}
