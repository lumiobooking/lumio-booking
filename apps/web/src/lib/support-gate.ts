/**
 * Which screens belong to LUMIO, not to the salon.
 *
 * The business model behind this list: marketing is a SERVICE the agency
 * sells, not a dashboard the salon operates. Lumio's own team — entering a
 * salon through a support session — configures the bot, runs the campaigns,
 * writes the monthly report. The salon buys outcomes. Showing the owner eight
 * screens of machinery they are not supposed to touch invites two failure
 * modes at once: they break a setup they pay the agency to maintain, and they
 * stop perceiving the service as a service.
 *
 * The one exception, by the owner of the platform's explicit instruction:
 * GOOGLE REVIEWS stays with the salon — replying to their own customers'
 * reviews is the salon's voice, not the agency's.
 *
 * This module decides; the shells obey. One list, one matcher, one spec —
 * because a hide-rule scattered across nav arrays and page guards is a rule
 * that will disagree with itself within a month.
 */

/** Route prefixes only a Lumio support session may see. */
export const SUPPORT_ONLY: string[] = [
  '/salon/marketing',        // covers /salon/marketing/monthly too
  '/salon/content',          // daily content plan — an agency deliverable
  '/salon/email',
  '/salon/reviews',          // rewards engine — NOT reviews-replies, see below
  '/salon/inbox',
  '/salon/messenger',
  '/salon/voice',
  '/staff/inbox',
];

/**
 * Prefix match with a path boundary, so '/salon/reviews' claims
 * '/salon/reviews' and '/salon/reviews/settings' but can never swallow
 * '/salon/reviews-replies' — the one route in this family the salon keeps.
 */
export function isSupportOnly(path: string): boolean {
  const p = String(path ?? '').split('?')[0];
  return SUPPORT_ONLY.some((base) => p === base || p.startsWith(base + '/'));
}

/** May THIS session see this route? */
export function canSee(path: string, isSupport: boolean): boolean {
  return isSupport || !isSupportOnly(path);
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
