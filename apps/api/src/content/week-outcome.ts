/**
 * What a week actually produced — the half of the record that was missing.
 *
 * THE GAP THIS CLOSES
 *
 * The archive stored the PLAN and nothing else. Open week 35 and you saw what
 * was meant to happen; nothing anywhere said what did. `resultNote` was written
 * into the database by the screen and read by not one line of code — I checked.
 * So the system could never learn which ideas worked, the team could never show
 * a client "we did this and that followed", and the roadmap advanced on ACTIVITY
 * (posts made, reviews collected) rather than on RESULT.
 *
 * For a marketing agency that is not a missing feature. It is the product.
 *
 * WHAT IS COUNTED, AND WHAT IS DELIBERATELY NOT CLAIMED
 *
 * Everything here is counted from rows the platform already writes: appointments
 * in that week, which of them were somebody's first visit, what they paid, how
 * many reviews arrived, how many planned jobs were marked done.
 *
 * What it does NOT do is attribute. It will not say "the Thursday post brought
 * six customers", because nothing in this data can support that: a booking made
 * on Thursday might have come from the post, from the sign outside, or from a
 * friend. The honest version is a WEEK-ON-WEEK comparison with the work that
 * happened beside it, and a reader who can see both and draw their own line.
 * A number that looks like attribution and is not is worse than no number,
 * because the client will make a spending decision on it.
 */

export interface WeekOutcome {
  /** ISO week this describes, e.g. "2026-W35". */
  weekKey: string;
  /** Jobs the plan asked for, and how many were marked done. */
  plannedJobs: number;
  doneJobs: number;
  /** Content pieces the salon actually recorded as posted. */
  posted: number;
  /** Of those, how many carry a link anyone can open. */
  postedWithLink: number;
  /** The salon's own numbers for that week. */
  bookings: number;
  newCustomers: number;
  revenueCents: number;
  reviews: number;
  /** Change against the week before. Null when there is no week before. */
  delta: {
    bookings: number | null;
    newCustomers: number | null;
    revenueCents: number | null;
    reviews: number | null;
  };
}

export interface OutcomeInput {
  weekKey: string;
  /** Appointments inside the week, already filtered by the caller. */
  bookings: { priceCents: number; isFirstVisit: boolean }[];
  /** The week before, for the comparison. Empty when there is none. */
  prevBookings: { priceCents: number; isFirstVisit: boolean }[] | null;
  reviews: number;
  prevReviews: number | null;
  /** Jobs the plan listed, excluding the deliberate rest days. */
  plannedJobs: number;
  /** Content ideas for those dates, with what became of them. */
  ideas: { status: string; postedUrl?: string | null }[];
}

const sum = (rows: { priceCents: number }[]) => rows.reduce((n, r) => n + (r.priceCents || 0), 0);
const firsts = (rows: { isFirstVisit: boolean }[]) => rows.filter((r) => r.isFirstVisit).length;

export function buildWeekOutcome(i: OutcomeInput): WeekOutcome {
  const done = i.ideas.filter((x) => x.status === 'posted' || x.status === 'filmed').length;
  const posted = i.ideas.filter((x) => x.status === 'posted').length;
  const postedWithLink = i.ideas.filter((x) => x.status === 'posted' && (x.postedUrl ?? '').trim()).length;

  const bookings = i.bookings.length;
  const newCustomers = firsts(i.bookings);
  const revenueCents = sum(i.bookings);

  // A delta needs a previous week that really exists. Comparing against an
  // absent week by treating it as zero would report a shop's first week as
  // infinite growth, which is the kind of number that gets screenshotted.
  const prev = i.prevBookings;
  const delta = {
    bookings: prev ? bookings - prev.length : null,
    newCustomers: prev ? newCustomers - firsts(prev) : null,
    revenueCents: prev ? revenueCents - sum(prev) : null,
    reviews: i.prevReviews === null ? null : i.reviews - i.prevReviews,
  };

  return {
    weekKey: i.weekKey,
    plannedJobs: Math.max(0, i.plannedJobs),
    doneJobs: done,
    posted,
    postedWithLink,
    bookings,
    newCustomers,
    revenueCents,
    reviews: i.reviews,
    delta,
  };
}

/**
 * The week in one line, for the archive strip and the client report.
 *
 * Written so a salon owner reads it without decoding anything, and so it never
 * implies the work caused the numbers — the two facts sit side by side and the
 * reader joins them, or does not.
 */
export function describeOutcome(o: WeekOutcome, money: (c: number) => string): string {
  const parts: string[] = [];
  if (o.plannedJobs) parts.push(`làm ${o.doneJobs}/${o.plannedJobs} việc`);
  parts.push(`${o.bookings} booking`);
  if (o.newCustomers) parts.push(`${o.newCustomers} khách mới`);
  if (o.revenueCents) parts.push(money(o.revenueCents));
  if (o.reviews) parts.push(`${o.reviews} đánh giá`);
  return parts.join(' · ');
}

/** "+4 booking, +2 khách mới so với tuần trước" — or nothing when there is no comparison. */
export function describeDelta(o: WeekOutcome): string {
  const bits: string[] = [];
  const add = (n: number | null, label: string) => {
    if (n === null || n === 0) return;
    bits.push(`${n > 0 ? '+' : ''}${n} ${label}`);
  };
  add(o.delta.bookings, 'booking');
  add(o.delta.newCustomers, 'khách mới');
  add(o.delta.reviews, 'đánh giá');
  return bits.length ? `${bits.join(', ')} so với tuần trước` : '';
}
