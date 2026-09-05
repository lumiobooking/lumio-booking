/**
 * Which screens belong to LUMIO, and which ones a salon has been handed.
 *
 * The business model behind this list: marketing is a SERVICE the agency
 * sells, not a dashboard the salon operates. Lumio's own team — entering a
 * salon through a support session — configures the bot, runs the campaigns,
 * writes the monthly report. The salon buys outcomes. Showing the owner eight
 * screens of machinery they are not supposed to touch invites two failure
 * modes at once: they break a setup they pay the agency to maintain, and they
 * stop perceiving the service as a service.
 *
 * That was originally written as one hard-coded list, which made it true of
 * every salon at once — so a salon that PAID for the marketing screens still
 * could not be given them without a deploy, and the per-tenant Feature access
 * switches in Super Admin quietly did nothing for this family of routes.
 *
 * So the list moved: Super Admin decides per salon (see the API's
 * feature-policy module), and this module applies the answer. Every switch
 * still ships OFF, so nothing changes for a salon nobody has decided about —
 * the difference is that now there is a decision to make.
 *
 * This module decides; the shells obey. One matcher, one spec — because a
 * hide-rule scattered across nav arrays and page guards is a rule that will
 * disagree with itself within a month.
 */

/**
 * Route prefixes only a Lumio support session may see, with no way to hand them
 * over. Everything else in the agency family now has a per-salon switch (see
 * DEFAULT_HIDDEN below), because "nobody, ever" and "nobody yet" are different
 * rules and only one of them can be sold.
 *
 * The staff inbox stays here: it is a different portal, not a salon screen.
 */
export const SUPPORT_ONLY: string[] = [
  '/staff/inbox',
];

/**
 * The agency-run screens, and what the salon sees before the server answers.
 *
 * Each of these has a switch in Super Admin → the salon → Feature access, and
 * every switch here ships OFF. `/salon/approve-posts` is deliberately absent:
 * it is the one screen that ships ON (see the API's feature-policy), so listing
 * it here would hide it for the half-second before the server answers — a flash
 * of nothing on the screen every client account opens most often. This list is what the shell assumes until
 * `/feature-policy` replies — pessimistic on purpose: a menu that renders
 * everything for half a second and then takes most of it away is worse than one
 * that never showed it, and a failed request must never open a screen.
 */
export const DEFAULT_HIDDEN: string[] = [
  '/salon/content',            // daily content plan — an agency deliverable
  '/salon/marketing',
  '/salon/marketing/monthly',
  '/salon/email',
  '/salon/reviews',            // rewards engine
  '/salon/reviews-replies',    // replying to Google reviews
  '/salon/inbox',
  '/salon/messenger',
  '/salon/voice',
];

/**
 * Prefix match with a path boundary, so '/salon/reviews' claims
 * '/salon/reviews' and '/salon/reviews/settings' but can never swallow
 * '/salon/reviews-replies' — two screens with two switches, and one spelling
 * must not decide the other.
 */
function matches(path: string, bases: string[]): boolean {
  const p = String(path ?? '').split('?')[0];
  return bases.some((base) => p === base || p.startsWith(base + '/'));
}

/** Belongs to Lumio outright — no switch can hand it over. */
export function isSupportOnly(path: string): boolean {
  return matches(path, SUPPORT_ONLY);
}

/**
 * Hidden from THIS salon right now.
 *
 * `hidden` is the list the server resolved for this tenant. It is a parameter
 * rather than a module constant because the answer differs per salon — which is
 * the whole point of the change: the same build shows the marketing plan to the
 * salon that bought it and not to the one that did not.
 */
export function isHidden(path: string, hidden: string[] = DEFAULT_HIDDEN): boolean {
  return matches(path, hidden);
}

/**
 * May THIS session see this route?
 *
 * A Lumio support session sees everything — that session exists to set these
 * screens up. Anyone else sees a route only if it is not Lumio's outright and
 * not currently switched off for this salon.
 */
export function canSee(path: string, isSupport: boolean, hidden: string[] = DEFAULT_HIDDEN): boolean {
  if (isSupport) return true;
  return !isSupportOnly(path) && !isHidden(path, hidden);
}

/** The wording on the door, for a salon account that navigates there anyway. */
export function gateText(vi: boolean): { title: string; body: string } {
  return vi
    ? {
        title: 'Mục này do Lumio Agency quản lý',
        body: 'Marketing, AI và các chiến dịch của tiệm được đội ngũ Lumio thiết lập và vận hành trọn gói. Cần điều chỉnh gì, nhắn Lumio là xong — bạn không phải đụng vào phần máy móc.',
      }
    : {
        title: 'This section is managed by Lumio Agency',
        body: 'Marketing, AI and campaigns are set up and run for you by the Lumio team. Message Lumio for any change — the machinery is our job.',
      };
}
