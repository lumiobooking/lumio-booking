import type { JobKind } from './weekly-plan';

/**
 * WHO DOES THIS PIECE OF WORK — the agency, or the shop.
 *
 * WHY THIS FILE EXISTS
 *
 * Lumio is a REMOTE agency. Nobody from the team is ever in the room. That one
 * fact decides what can be promised to a salon and what has to be asked of it,
 * and until now it was nowhere in the code — so the plan said things it could
 * not mean:
 *
 *   - `crew-board.ts` routed `event` jobs to a designer in Vietnam. Their steps
 *     are "pick a partner within 1km", "print 30 cards", "photograph both
 *     owners together". Nobody in that queue can do any of it.
 *   - `weekly-ask.ts` promised the shop ONE ask a week, and counted only
 *     filming and photography. Three daily habits, eight roadmap tasks and six
 *     partnership jobs walked straight past the counter.
 *   - `engage` — replying to comments, messages and reviews — was filed as the
 *     shop's habit at the counter although it is desk work, and was excluded
 *     from the crew queue, so it appeared on neither side's screen.
 *   - `seo-roadmap.ts` carries 67 tasks and one comment pointing all of them at
 *     "salon staff", including the 45 the agency plainly owns.
 *
 * Each of those is the same missing field, so there is one field and one place
 * that answers it. Anything that needs to know who does a piece of work reads
 * it from here — never from the kind, never from where the string happens to be
 * rendered.
 *
 * THE RULE FOR DECIDING
 *
 * Salon work is work that CANNOT be done from a laptop in another country:
 * a camera pointed at a hand, a word said to a customer standing there, paper
 * put on a counter. Everything else is the agency's, and saying otherwise is
 * how a client ends up doing work she is paying not to do.
 */
export type JobOwner = 'agency' | 'salon';

/**
 * The default owner for a kind.
 *
 * A DEFAULT, not a verdict: `Job.who` overrides it, because two jobs of one
 * kind can belong to different people. A behind-the-scenes story cut from
 * footage the shop already sent is desk work; the same story shot live in the
 * room is not.
 */
export const OWNER_OF: Record<JobKind, JobOwner> = {
  // The camera is in that room and the agency is not.
  film: 'salon',
  photo: 'salon',
  // Partnerships, print, in-shop events: a person has to be standing there.
  event: 'salon',
  // Desk work, all of it — editing, writing, scheduling, replying, the profile.
  post: 'agency',
  story: 'agency',
  offer: 'agency',
  winback: 'agency',
  engage: 'agency',
  gbp: 'agency',
  // Not work at all; on neither queue. See NOT_WORK.
  rest: 'agency',
};

/** Filler the plan prints on an empty day. Never queued, never counted. */
export const NOT_WORK: JobKind[] = ['rest'];

export interface OwnedLike { kind: JobKind; who?: JobOwner | null }

export function ownerOf(job: OwnedLike): JobOwner {
  return job.who ?? OWNER_OF[job.kind] ?? 'agency';
}

/** Real work the SHOP has to do with its own hands this week. */
export function isSalonWork(job: OwnedLike): boolean {
  return !NOT_WORK.includes(job.kind) && ownerOf(job) === 'salon';
}

/** Real work that lands in the team's queue. */
export function isAgencyWork(job: OwnedLike): boolean {
  return !NOT_WORK.includes(job.kind) && ownerOf(job) === 'agency';
}

/**
 * THE ONE THING THE SHOP CANNOT BE ASKED TO DO WITHOUT ITS OWN HANDS.
 *
 * Filming and photographing are one physical act — the phone goes on the stand
 * once — so they are one ask with one deadline however many jobs the plan
 * splits them into. Everything else salon-owned is listed separately rather
 * than folded in, because folding it in is how an "ask" quietly became a shift.
 */
export const MEDIA_KINDS: JobKind[] = ['film', 'photo'];

export const isMediaAsk = (job: OwnedLike): boolean =>
  MEDIA_KINDS.includes(job.kind) && isSalonWork(job);

/**
 * THE OWNER OF A DAILY HABIT, WHEN NOBODY WROTE ONE DOWN.
 *
 * `industry-playbook.ts` tags its habits by hand. The trades whose playbook is
 * generated rather than hand-written (see trade-profile.ts) arrive without a
 * tag, and defaulting them to the shop would put "reply to every message" back
 * on a client who is paying us to answer messages.
 *
 * The rule is the same one used by hand, and it is about hands, not topics:
 *   - a story habit means pointing a camera at something in the room → shop
 *   - asking a customer for a review, or booking her next visit at the counter,
 *     needs a person standing in front of her → shop
 *   - everything else is a keyboard → us
 */
export function habitOwner(kind: 'engage' | 'story', viText: string): JobOwner {
  if (kind === 'story') return 'salon';
  const t = String(viText ?? '').trim().toLowerCase();
  return /^(xin|hẹn|đưa|in |dán|nhờ khách|mời khách)/.test(t) ? 'salon' : 'agency';
}
