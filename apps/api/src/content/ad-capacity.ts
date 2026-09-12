/**
 * How many visits this salon could actually take, if advertising brought them.
 *
 * WHY THIS FILE EXISTS — THE NUMBER IT REPLACES
 *
 * The ad screen refused a salon with: "the smallest measurable campaign needs
 * 5 new customers and your quiet hours only hold 0." That salon was being set
 * up. It was close to empty. The honest answer was "every chair is free".
 *
 * The old figure was not free capacity at all. It was the gap BETWEEN
 * weekdays: take the busiest day's booked minutes, subtract each of the three
 * quietest days from it, and call the difference "room".
 *
 *     idle = Σ (peakMinutes − quietMinutes)   over the 3 quietest weekdays
 *
 * Read what that does to a salon with two appointments a day, every day. Peak
 * equals quiet, the difference is zero, and the screen reports no room — for a
 * shop that is ninety-five per cent empty. The formula measures UNEVENNESS,
 * and the one thing it cannot see is a salon that is evenly empty, which is
 * exactly the salon that needs customers most. A full salon and an empty one
 * both come out as 0, and the product cannot tell them apart.
 *
 * It was also blind by construction: every input came from appointments booked
 * through Lumio. A salon that joined last week has no such history, so the
 * whole capacity question was being answered from the one source that is
 * guaranteed to be empty for a new client.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Capacity is a property of the shop, not of its booking history:
 *
 *     open hours per week × people who can serve at once − what is booked
 *
 * Both of the first two are on file from the day the salon is set up, before a
 * single appointment exists. Booked minutes are subtracted when there are
 * enough days of them to mean anything, and treated as zero when there are
 * not — because a shop with no bookings has all its chairs free, which is the
 * answer the old formula got exactly backwards.
 *
 * AND THE RULE THAT MATTERS MOST
 *
 * Zero is only ever returned when zero was MEASURED. When the inputs are not
 * there, the answer is null and the caller says what is missing. A screen that
 * prints "0 chỗ" from missing data does not look uncertain — it looks certain
 * and wrong, and it tells a salon owner not to spend money for a reason that
 * is not true.
 */

/**
 * The week assumed for a salon that has not filled in its opening hours.
 *
 * Six days, eight hours. Deliberately modest: this number is a denominator for
 * "how full are you", so guessing high would make every salon look emptier
 * than it is and wave through campaigns that have nowhere to put the people.
 * It is always reported as `assumed-hours`, never as a measurement.
 */
export const ASSUMED_OPEN_MINUTES_PER_WEEK = 6 * 8 * 60;

/**
 * Days of booking history below which "what is booked" is not evidence.
 *
 * Two weeks. Under that, a quiet fortnight and a new account look identical,
 * and the safe reading is the one that does not refuse a campaign: treat the
 * book as empty, which for a salon that genuinely is empty is also the true
 * one.
 */
export const MIN_HISTORY_DAYS = 14;

/** At or above this, the shop is full and more traffic has nowhere to sit. */
export const FULL_PCT = 92;

/**
 * THE TWO SAFETY FACTORS, AND WHY A RAW CAPACITY NUMBER IS USELESS.
 *
 * The first version of this file computed open hours x chairs and printed the
 * result: "your quiet hours hold 717". That is arithmetically true and useless
 * as advice — it is the number you get if every chair is busy every open minute
 * for a fortnight, which no salon has ever done. The agency owner who has to
 * say this figure out loud to a client asked for a number he can defend, and
 * 717 is not one.
 *
 * So two factors, each defensible in a single sentence to a salon owner:
 *
 *   ADS_SHARE            one two-week campaign is asked to fill a QUARTER of
 *                        the genuinely free chair-time, not all of it. The rest
 *                        is for walk-ins, regulars rebooking, and the ordinary
 *                        unevenness of a working week.
 *
 *   EXTRA_PER_CHAIR_DAY  and never more than one extra customer per technician
 *                        per day, whatever the arithmetic says. "Could each of
 *                        your techs take one more customer a day?" is a
 *                        question an owner answers yes to without thinking, and
 *                        that is the bar this number has to clear.
 *
 * The smaller of the two wins. In practice the cap governs, which is the point:
 * the figure on screen is the one the owner would have guessed, and the working
 * printed beside it is "5 thợ x 14 ngày x 1 khách".
 */
export const ADS_SHARE = 0.25;
export const EXTRA_PER_CHAIR_DAY = 1;

export type CapacityBasis = 'measured' | 'assumed-hours' | 'unknown';

/**
 * Where the chair count came from.
 *
 * 'staff' is the list the salon set up. 'busiest-day' is a MEASUREMENT taken
 * when that list is empty — a great many salons never fill it in, and refusing
 * to answer for all of them is not a service. If this shop has ever had nine
 * hours of work booked on a nine-hour day, two people were working; the busiest
 * day it has ever had is a floor on how many chairs it has, and it costs no
 * extra query because the booking minutes are already here.
 */
export type ChairsFrom = 'staff' | 'busiest-day' | 'none';

export interface CapacityInput {
  /** Minutes the salon is open across one week, from its own opening hours. */
  openMinutesPerWeek?: number | null;
  /** How many people can serve a customer at the same time. */
  chairs?: number | null;
  /**
   * Booked minutes on the salon's busiest single day, when it has one.
   * Used only to infer a chair count for a salon that never set its staff up.
   */
  busiestDayMinutes?: number | null;
  /**
   * How many days a week the salon actually opens.
   *
   * Needed because the inferred chair count divides a day's booked minutes by
   * the length of a DAY, and a six-day week divided by seven makes every day
   * look shorter than it is — which rounds the chair count up and quietly
   * inflates the figure the owner is asked to defend.
   */
  openDaysPerWeek?: number | null;
  /** Minutes booked through Lumio over `historyDays`. */
  bookedMinutes?: number | null;
  /** How many days that booked figure covers. */
  historyDays?: number | null;
  /** How long one visit takes here, from the salon's own service list. */
  slotMinutes?: number | null;
  /** How many days the campaign would run. */
  campaignDays: number;
}

export interface Capacity {
  /** Visits the campaign could fill. Null when it is not knowable yet. */
  slots: number | null;
  /** How full the salon is, 0-100. Null when not knowable. */
  utilisationPct: number | null;
  basis: CapacityBasis;
  /** What is missing, when the honest answer is "we do not know". */
  missing: ('hours' | 'chairs')[];
  /** The chair count actually used, and where it came from. */
  chairs: number | null;
  chairsFrom: ChairsFrom;
}

const DEFAULT_SLOT_MINUTES = 60;

export function adCapacity(i: CapacityInput): Capacity {
  const hours = num(i.openMinutesPerWeek);
  const days = Math.max(1, i.campaignDays);
  const openWeek = hours && hours > 0 ? hours : ASSUMED_OPEN_MINUTES_PER_WEEK;
  const basis: CapacityBasis = hours && hours > 0 ? 'measured' : 'assumed-hours';

  // The staff list first; the busiest day the salon has ever worked second.
  // Very many salons never fill the staff list in, and "we cannot say" for all
  // of them helps nobody — their own booking book answers the question.
  const stated = num(i.chairs);
  const busiest = num(i.busiestDayMinutes);
  const openDays = Math.min(7, Math.max(1, num(i.openDaysPerWeek) ?? 6));
  const dayMinutes = openWeek / openDays;
  const implied = busiest && busiest > 0 && dayMinutes > 0
    ? Math.max(1, Math.round(busiest / dayMinutes))
    : null;
  const chairs = stated && stated > 0 ? stated : implied;
  const chairsFrom: ChairsFrom = stated && stated > 0 ? 'staff' : implied ? 'busiest-day' : 'none';

  const missing: ('hours' | 'chairs')[] = [];
  if (!hours || hours <= 0) missing.push('hours');
  if (!chairs) missing.push('chairs');

  // No staff list and no booking history: there is nothing to measure and
  // nothing worth guessing. Null, so the caller says what is missing rather
  // than printing a number it cannot stand behind.
  if (!chairs) {
    return { slots: null, utilisationPct: null, basis: 'unknown', missing, chairs: null, chairsFrom };
  }

  const capacityMinutes = openWeek * chairs * (days / 7);
  if (capacityMinutes <= 0) {
    return { slots: null, utilisationPct: null, basis: 'unknown', missing, chairs, chairsFrom };
  }

  // Booked minutes only count as evidence once there are enough days of them.
  // Below that, an empty book is what a new account looks like AND what an
  // empty salon looks like, and only one of those readings is safe.
  const history = num(i.historyDays) ?? 0;
  const booked = num(i.bookedMinutes) ?? 0;
  const bookedInWindow = history >= MIN_HISTORY_DAYS && booked > 0
    ? booked * (days / history)
    : 0;

  const utilisationPct = Math.max(0, Math.min(100, Math.round((bookedInWindow / capacityMinutes) * 100)));
  const freeMinutes = Math.max(0, capacityMinutes - bookedInWindow);
  const slot = Math.max(15, num(i.slotMinutes) ?? DEFAULT_SLOT_MINUTES);

  // The two safety factors, smaller wins. See ADS_SHARE / EXTRA_PER_CHAIR_DAY.
  const fromFreeTime = Math.floor((freeMinutes * ADS_SHARE) / slot);
  const fromChairs = Math.floor(chairs * days * EXTRA_PER_CHAIR_DAY);

  return {
    slots: Math.max(0, Math.min(fromFreeTime, fromChairs)),
    utilisationPct,
    basis,
    missing,
    chairs,
    chairsFrom,
  };
}

/** Is this salon genuinely too full to take more people? */
export function isFull(c: Capacity): boolean {
  return c.utilisationPct !== null && c.utilisationPct >= FULL_PCT;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** How many days a week this salon opens at all. */
export function openDaysPerWeek(
  days: { closed?: boolean; openMinutes?: number; closeMinutes?: number; intervals?: { open: number; close: number }[] }[] | null | undefined,
): number | null {
  if (!Array.isArray(days) || days.length === 0) return null;
  const open = days.filter((d) => d && !d.closed && (openMinutesPerWeek([d]) ?? 0) > 0).length;
  return open > 0 ? open : null;
}

/** Open minutes in one week, from the salon's own business hours. */
export function openMinutesPerWeek(
  days: { closed?: boolean; openMinutes?: number; closeMinutes?: number; intervals?: { open: number; close: number }[] }[] | null | undefined,
): number | null {
  if (!Array.isArray(days) || days.length === 0) return null;
  let total = 0;
  for (const d of days) {
    if (!d || d.closed) continue;
    const windows = Array.isArray(d.intervals) && d.intervals.length
      ? d.intervals
      : [{ open: Number(d.openMinutes ?? 0), close: Number(d.closeMinutes ?? 0) }];
    for (const w of windows) {
      const span = Number(w.close) - Number(w.open);
      if (Number.isFinite(span) && span > 0) total += span;
    }
  }
  return total > 0 ? total : null;
}
