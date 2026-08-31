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

export function bookingChannel(b: {
  source?: string | null; utmSource?: string | null; attrReferrer?: string | null;
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
  const refined = (utm ? fromUtm(utm) : null) ?? fromReferrer(b?.attrReferrer);

  if (s === 'plugin' || s === 'website' || s === 'wordpress') return refined ?? 'website';
  if (s === 'hosted' || s === 'lumiolink' || s === 'link') return refined ?? 'lumiolink';
  return refined ?? 'online';
}

/**
 * How much of the book can be attributed at all.
 *
 * `online` means "a booking arrived through a web door carrying no utm and no
 * referrer" — a real booking whose origin is genuinely unknown. Reporting a
 * channel split without saying what share of it is this bucket is how a chart
 * built on a third of the data gets read as the whole picture.
 */
export function channelCoverage(channels: BookingChannel[]): {
  total: number; attributed: number; pct: number; unknown: number;
} {
  const total = channels.length;
  const unknown = channels.filter((c) => c === 'online').length;
  const attributed = total - unknown;
  return { total, attributed, unknown, pct: total ? Math.round((attributed / total) * 100) : 0 };
}
