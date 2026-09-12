/**
 * Which marketing channel a booking actually came from.
 *
 * WHY THIS EXISTS — A BUG WORTH WRITING DOWN
 *
 * The ads engine was counting channels like this:
 *
 *     const google = n('google') + n('gbp') + n('organic') + n('website');
 *     const meta   = n('facebook') + n('instagram') + n('messenger');
 *
 * Not one of `google`, `gbp` or `organic` is a value this platform ever writes.
 * The booking table's Google key is `gmap`. So every Google Maps booking — for
 * most salons the single largest source of new customers — was invisible to the
 * engine deciding where to spend the advertising money, while `website` (which
 * is the salon's own site, not Google) was being counted as Google.
 *
 * The keys were not made up out of nothing. They are what someone would guess
 * the values are, and guessing is the whole problem: a channel tally that reads
 * keys the writer never writes returns zero and looks like a finding.
 *
 * TWO LAYERS, AND THE ORDER MATTERS
 *
 * `source` says which DOOR the booking came through — the WordPress plugin, the
 * hosted Lumio link, the AI hotline, a chat thread, the front desk. `utmSource`
 * and `attrReferrer` say who SENT them to that door. The door wins whenever it
 * is specific: a Messenger booking carrying a stray `utm_source=facebook` is a
 * Messenger booking, because the thread is stronger evidence than a parameter
 * someone pasted into a link. The referrer only refines the anonymous web doors,
 * where it is the only evidence there is.
 *
 * The engine previously did `utm || raw`, which is that rule backwards.
 *
 * This mirrors `apps/web/src/lib/booking-sources.ts` deliberately and exactly.
 * Two copies is one more than anybody wants; the alternative was a third
 * divergent tally, which is what we had. A parity test keeps them honest.
 */

export type BookingChannel =
  | 'gmap' | 'facebook' | 'instagram' | 'messenger' | 'zalo'
  | 'hotline' | 'website' | 'lumiolink' | 'walkin' | 'staff' | 'online';

export const BOOKING_CHANNELS: BookingChannel[] = [
  'gmap', 'facebook', 'instagram', 'messenger', 'zalo', 'hotline',
  'website', 'lumiolink', 'walkin', 'staff', 'online',
];

/** What the salon calls it. */
export const CHANNEL_VI: Record<BookingChannel, string> = {
  gmap: 'Google Maps / Tìm kiếm',
  facebook: 'Facebook',
  instagram: 'Instagram',
  messenger: 'Messenger',
  zalo: 'Zalo',
  hotline: 'Gọi điện',
  website: 'Website tiệm',
  lumiolink: 'Link đặt lịch Lumio',
  walkin: 'Khách vãng lai',
  staff: 'Nhân viên tạo tại tiệm',
  online: 'Đặt online (chưa rõ nguồn)',
};

/**
 * The ad platform that can buy more of this channel.
 *
 * `owned` and `offline` exist so the engine cannot be tempted to recommend
 * spending on them. Nobody sells advertising that produces walk-ins directly,
 * and a salon's own booking link is not a marketplace — those channels grow
 * from the work, not from a budget.
 */
export type AdPlatform = 'google' | 'meta' | 'zalo' | 'owned' | 'offline';

export const PLATFORM_OF: Record<BookingChannel, AdPlatform> = {
  gmap: 'google',
  facebook: 'meta',
  instagram: 'meta',
  messenger: 'meta',
  zalo: 'zalo',
  hotline: 'offline',
  walkin: 'offline',
  staff: 'offline',
  website: 'owned',
  lumiolink: 'owned',
  online: 'owned',
};

export const PLATFORM_VI: Record<AdPlatform, string> = {
  google: 'Google (Tìm kiếm + Maps)',
  meta: 'Meta (Facebook + Instagram)',
  zalo: 'Zalo',
  owned: 'Kênh của tiệm (website, link đặt lịch)',
  offline: 'Ngoài đời (vãng lai, gọi điện, tại quầy)',
};

function fromReferrer(ref: string | null | undefined): BookingChannel | null {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)google\./.test(host) || host.includes('googleusercontent')) return 'gmap';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || host.endsWith('.facebook.com')) return 'facebook';
  if (host.includes('instagram')) return 'instagram';
  if (host.includes('zalo')) return 'zalo';
  return null;
}

function fromUtm(utm: string): BookingChannel | null {
  const v = utm.toLowerCase();
  if (/\bfb\b|facebook|fbclid/.test(v)) return 'facebook';
  if (/\big\b|instagram/.test(v)) return 'instagram';
  if (/google|gmb|gbp|maps/.test(v)) return 'gmap';
  if (/zalo/.test(v)) return 'zalo';
  return null;
}


/**
 * THE LANDING URL — the evidence that cannot be lost.
 *
 * WHY A THIRD LAYER EXISTS
 *
 * Google Maps was the largest source of new customers for most salons and the
 * book recorded almost none of it. Every link in the chain was correct: the
 * /gbp route exists, it stamps utm_source=google, the DTO accepts it, the
 * service stores it, this function maps it. And the tally still read zero,
 * because BOTH of the two signals it had can be absent:
 *
 *   utm       — only present if the salon actually pasted the /gbp link into
 *               its Google profile. Until it does, a Google customer arrives
 *               on the plain link carrying nothing.
 *   referrer  — empty for most Google Maps traffic. The Maps app opens the
 *               booking link in an in-app browser or a Custom Tab, and there
 *               is no document.referrer in one. Google's own redirect hops
 *               strip it too. This fallback was written for exactly this case
 *               and is the least reliable precisely there.
 *
 * The PATH is the third signal and the only one that cannot go missing: it is
 * the route the customer asked for, it is in the landing URL the booking page
 * already sends, and nothing between Google and the form rewrites it. If the
 * stamping effect fails — as its predecessor did, silently, for months — the
 * landing URL still ends in /gbp and the booking is still Google's.
 *
 * Checked AFTER the utm and the referrer, so an explicit campaign still wins.
 */
function fromLanding(url: string | null | undefined): BookingChannel | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  let path = '';
  try { path = new URL(raw).pathname; } catch { path = raw.split('?')[0]; }
  return /\/gbp\/?$/.test(path) ? 'gmap' : null;
}

export function bookingChannel(b: {
  source?: string | null; utmSource?: string | null; attrReferrer?: string | null;
  attrLandingUrl?: string | null;
}): BookingChannel {
  const s = String(b?.source ?? '').trim().toLowerCase();

  if (s === 'instagram' || s === 'ig') return 'instagram';
  if (s === 'messenger' || s === 'facebook' || s === 'fb' || s === 'chat') return 'messenger';
  if (s === 'zalo') return 'zalo';
  if (s === 'hotline' || s === 'voice' || s === 'call' || s === 'phone') return 'hotline';
  if (s === 'walkin' || s === 'walk-in' || s === 'retail' || s === 'counter') return 'walkin';
  if (s === 'admin' || s === 'staff' || s === 'manual') return 'staff';
  if (s === 'gmap' || s === 'google' || s === 'gbp' || s === 'rwg' || s === 'reserve_with_google') return 'gmap';

  const utm = String(b?.utmSource ?? '').trim();
  const refined = (utm ? fromUtm(utm) : null)
    ?? fromReferrer(b?.attrReferrer)
    ?? fromLanding(b?.attrLandingUrl);

  if (s === 'plugin' || s === 'website' || s === 'wordpress') return refined ?? 'website';
  if (s === 'hosted' || s === 'lumiolink' || s === 'link') return refined ?? 'lumiolink';
  return refined ?? 'online';
}

/**
 * A DOOR IS NOT A SOURCE.
 *
 * This counted everything except `online` as attributed, and that made the
 * coverage number wrong in the direction that flatters us. A salon's screen
 * read "Link Lumio 95 · Tạo tại tiệm 34" and reported 100% coverage, while the
 * agency owner was telling us the exact opposite: khách về từ Google rất nhiều
 * nhưng hệ thống gần như không ghi nhận được.
 *
 * Both statements were true. `lumiolink` and `website` are DOORS — the hosted
 * booking page, the shop's own site. A booking that came through one carrying
 * no utm, no referrer and no landing path tells us the customer used that door
 * and nothing whatsoever about what sent her to it. She may have come off the
 * Google profile, off a friend's recommendation, off a sign in the window.
 * Counting her as "attributed" answers a question nobody asked.
 *
 * The question the report answers is "where do my customers come FROM", so the
 * unknown bucket is every booking that cannot answer it. The number drops on
 * every salon the day this ships. It drops to the truth, and the truth is what
 * makes the fix — a /gbp link, a utm on every shared link — worth doing.
 */
export const SOURCELESS: BookingChannel[] = ['online', 'lumiolink', 'website'];

export function channelCoverage(channels: BookingChannel[]): {
  total: number;
  attributed: number;
  pct: number;
  unknown: number;
  /**
   * Of the unknown ones, how many at least came through a door we own.
   *
   * Kept separate because the fix is different: a `lumiolink` booking is one
   * utm away from being attributed, and an `online` booking may be a walk-in
   * somebody typed in. Telling an owner "95 of these are one link away" is
   * actionable; "125 unknown" is just bad news.
   */
  ownedDoor: number;
} {
  const total = channels.length;
  const unknownList = channels.filter((c) => SOURCELESS.includes(c));
  const unknown = unknownList.length;
  const ownedDoor = unknownList.filter((c) => c !== 'online').length;
  const attributed = total - unknown;
  return {
    total, attributed, unknown, ownedDoor,
    pct: total ? Math.round((attributed / total) * 100) : 0,
  };
}
